import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { auditInputSchema } from "@/lib/audit/schema";
import { runAudit } from "@/lib/audit/engine";
import type { AuditInput } from "@/lib/audit/types";
import type { Database, Json } from "@/integrations/supabase/types";
import { PLAN_AUDIT_LIMITS } from "./plan-limits";
import { verifiedBusinessFor } from "./verified-business";

export type AuditRow = Database["public"]["Tables"]["audits"]["Row"];
export type FindingRow = Database["public"]["Tables"]["audit_findings"]["Row"];

const createPayload = auditInputSchema
  .omit({ businessName: true, primaryCategory: true, city: true, websiteUrl: true })
  .extend({
    locationId: z.string().uuid().optional().nullable(),
    verificationId: z.string().uuid(),
  });

/** Audits used this calendar month across BOTH audit types (profile + website). */
async function auditsUsedThisMonth(supabase: NonNullable<unknown>, userId: string): Promise<number> {
  const client = supabase as import("@supabase/supabase-js").SupabaseClient;
  const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const [{ count }, { count: webCount }] = await Promise.all([
    client.from("audits").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", monthStart),
    client
      .from("website_audits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", monthStart),
  ]);
  return (count ?? 0) + (webCount ?? 0);
}

/** Monthly quota for the signed-in user, derived from their plan. */
export const getUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [{ data: profile }, used] = await Promise.all([
      supabase.from("profiles").select("plan").eq("id", userId).maybeSingle(),
      auditsUsedThisMonth(supabase, userId),
    ]);

    const plan = profile?.plan ?? "free";
    const limit = PLAN_AUDIT_LIMITS[plan] ?? null;

    return { plan, limit, used, remaining: limit === null ? null : Math.max(0, limit - used) };
  });

/** Runs the scoring engine server-side and persists the report with findings. */
export const createAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createPayload.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { locationId, verificationId, ...rest } = data;
    const business = await verifiedBusinessFor(supabase, userId, verificationId);
    if (!business.businessName) {
      throw new Error(
        business.nameStatus === "conflicting"
          ? "Your links disagree about the business name. Fix or replace the links and verify again before auditing."
          : "We couldn't confirm the business name from your links. Add the official website and verify again.",
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .maybeSingle();

    const plan = profile?.plan ?? "free";
    const limit = PLAN_AUDIT_LIMITS[plan] ?? null;

    if (limit !== null) {
      const used = await auditsUsedThisMonth(supabase, userId);
      if (used >= limit) {
        throw new Error(
          `Monthly audit limit reached for the ${plan} plan (${limit} audits, profile and website audits combined). Upgrade to run more this month.`,
        );
      }
    }

    const input = {
      ...rest,
      businessName: business.businessName,
      primaryCategory: business.primaryCategory ?? "Not verified",
      city: business.city ?? "Not verified",
      websiteUrl: business.websiteUrl ?? undefined,
    } as AuditInput;
    const result = runAudit(input);

    // Results are written with server access only, so they can't be forged from the browser.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: audit, error } = await supabaseAdmin
      .from("audits")
      .insert({
        user_id: userId,
        location_id: locationId ?? null,
        verification_id: business.verificationId,
        business_name: input.businessName,
        primary_category: input.primaryCategory,
        city: input.city,
        overall_score: result.overallScore,
        grade: result.grade,
        category_scores: result.categoryScores as unknown as Json,
        inputs: input as unknown as Json,
        engine_version: result.engineVersion,
      })
      .select("id")
      .single();

    if (error || !audit) throw new Error(error?.message ?? "Could not save the audit");

    const { error: findingsError } = await supabaseAdmin.from("audit_findings").insert(
      result.findings.map((finding, index) => ({
        audit_id: audit.id,
        check_key: finding.checkKey,
        category: finding.category,
        label: finding.label,
        status: finding.status,
        weight: finding.weight,
        points_earned: finding.pointsEarned,
        impact: finding.impact,
        recommendation: finding.recommendation,
        sort_order: index,
      })),
    );

    if (findingsError) throw new Error(findingsError.message);

    await supabase.from("activity_events").insert({
      user_id: userId,
      event_type: "audit_created",
      metadata: { score: result.overallScore, category: input.primaryCategory },
    });

    return { auditId: audit.id, score: result.overallScore, grade: result.grade };
  });

export const listAudits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("audits")
      .select("id, business_name, primary_category, city, overall_score, grade, created_at, location_id")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ auditId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: audit, error } = await supabase
      .from("audits")
      .select("*")
      .eq("id", data.auditId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!audit) return null;

    const { data: findings, error: findingsError } = await supabase
      .from("audit_findings")
      .select("*")
      .eq("audit_id", data.auditId)
      .order("sort_order", { ascending: true });

    if (findingsError) throw new Error(findingsError.message);

    return { audit, findings: findings ?? [] };
  });

export const deleteAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ auditId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("audits")
      .delete()
      .eq("id", data.auditId)
      .eq("user_id", context.userId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

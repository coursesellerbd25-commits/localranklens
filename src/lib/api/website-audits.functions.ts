import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { PLAN_AUDIT_LIMITS, quotaMessage } from "./plan-limits";
import { verifiedBusinessFor } from "./verified-business";

export type WebsiteAuditRow = import("@/integrations/supabase/types").Database["public"]["Tables"]["website_audits"]["Row"];
export type WebsiteFindingRow =
  import("@/integrations/supabase/types").Database["public"]["Tables"]["website_audit_findings"]["Row"];

const websiteAuditPayload = z.object({
  verificationId: z.string().uuid(),
});

/** Monthly quota, shared with the Google Business Profile audit limit. */
export async function assertQuota(supabase: NonNullable<unknown>, userId: string): Promise<void> {
  const client = supabase as import("@supabase/supabase-js").SupabaseClient;
  const [{ data: profile }, { count: gbpCount }, { count: webCount }] = await Promise.all([
    client.from("profiles").select("plan").eq("id", userId).maybeSingle(),
    client
      .from("audits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", new Date(new Date().setDate(1)).toISOString().slice(0, 10)),
    client
      .from("website_audits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", new Date(new Date().setDate(1)).toISOString().slice(0, 10)),
  ]);

  const plan = profile?.plan ?? "free";
  const limit = PLAN_AUDIT_LIMITS[plan] ?? null;
  if (limit !== null && ((gbpCount ?? 0) + (webCount ?? 0)) >= limit) {
    throw new Error(quotaMessage(plan, limit));
  }
}

/** Fetches, crawls and scores a website, then saves the report. */
export const createWebsiteAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => websiteAuditPayload.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const business = await verifiedBusinessFor(supabase, userId, data.verificationId);
    if (!business.websiteUrl) {
      throw new Error("This verification has no working official website. Add the website link and verify again.");
    }
    await assertQuota(supabase, userId);

    const { runWebsiteAuditPipeline, SiteAuditError } = await import("@/lib/site-audit/pipeline.server");
    let pipeline;
    try {
      // URL and business details come from the verified record, not from typed input.
      pipeline = await runWebsiteAuditPipeline({
        url: business.websiteUrl,
        businessName: business.businessName ?? undefined,
        phone: business.phone ?? undefined,
        city: business.city ?? undefined,
      });
    } catch (error) {
      if (error instanceof SiteAuditError) throw new Error(error.message);
      throw new Error("We couldn't analyze this website. Please try again shortly.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: audit, error } = await supabaseAdmin
      .from("website_audits")
      .insert({
        user_id: userId,
        verification_id: business.verificationId,
        url: pipeline.data.requestedUrl,
        final_url: pipeline.data.main?.finalUrl ?? null,
        domain: new URL(pipeline.data.requestedUrl).hostname,
        status: "complete",
        overall_score: pipeline.result.overallScore,
        grade: pipeline.result.grade,
        category_scores: pipeline.result.categoryScores as unknown as Json,
        local_readiness: pipeline.local as unknown as Json,
        pagespeed: pipeline.data.psi as unknown as Json,
        audit_meta: {
          robots: pipeline.data.robots,
          sitemap: pipeline.data.sitemap,
          subpages: pipeline.data.subpages,
          totalElapsedMs: pipeline.data.totalElapsedMs,
          redirectChain: pipeline.data.main?.redirectChain ?? [],
          pageBytes: pipeline.data.main?.bytes ?? null,
          responseTimeMs: pipeline.data.main?.elapsedMs ?? null,
          testedAt: new Date().toISOString(),
        } as unknown as Json,
        engine_version: pipeline.result.engineVersion,
      })
      .select("id")
      .single();

    if (error || !audit) throw new Error(error?.message ?? "Could not save the website audit");

    const { error: findingsError } = await supabaseAdmin.from("website_audit_findings").insert(
      pipeline.result.findings.map((finding, index) => ({
        audit_id: audit.id,
        check_key: finding.checkKey,
        category: finding.category,
        label: finding.label,
        status: finding.status,
        weight: finding.weight,
        points_earned: finding.pointsEarned,
        impact: finding.priority,
        priority: finding.priority,
        observed: finding.observed,
        evidence: finding.evidence as unknown as Json,
        explanation: finding.explanation,
        recommendation: finding.recommendation,
        fix_example: finding.fixExample ?? null,
        manual_verification: finding.manualVerification ?? false,
        sort_order: index,
      })),
    );
    if (findingsError) throw new Error(findingsError.message);

    await supabase.from("activity_events").insert({
      user_id: userId,
      event_type: "website_audit_created",
      metadata: {
        score: pipeline.result.overallScore,
        localScore: pipeline.local.score,
        domain: new URL(pipeline.data.requestedUrl).hostname,
      },
    });

    return {
      auditId: audit.id,
      score: pipeline.result.overallScore,
      grade: pipeline.result.grade,
      localScore: pipeline.local.score,
      notTestedCount: pipeline.result.notTestedCount,
    };
  });

export const listWebsiteAudits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("website_audits")
      .select("id, url, domain, overall_score, grade, created_at, status")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getWebsiteAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ auditId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: audit, error } = await supabase
      .from("website_audits")
      .select("*")
      .eq("id", data.auditId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!audit) return null;

    const { data: findings, error: findingsError } = await supabase
      .from("website_audit_findings")
      .select("*")
      .eq("audit_id", data.auditId)
      .order("sort_order", { ascending: true });
    if (findingsError) throw new Error(findingsError.message);

    return { audit, findings: findings ?? [] };
  });

export const deleteWebsiteAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ auditId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("website_audits")
      .delete()
      .eq("id", data.auditId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

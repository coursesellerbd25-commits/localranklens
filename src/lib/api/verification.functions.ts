import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { MAX_SOURCES, validateSubmittedLinks } from "@/lib/verification/sources";
import { assessVerification } from "@/lib/verification/assess";

export type VerificationRow = Database["public"]["Tables"]["business_verifications"]["Row"];
export type SourceRow = Database["public"]["Tables"]["business_sources"]["Row"];

const DAILY_VERIFICATION_LIMIT = 30;

const verifyPayload = z.object({
  links: z.array(z.string().max(2048)).min(1).max(MAX_SOURCES),
  previousVerificationId: z.string().uuid().nullable().optional(),
});

export type VerifyBusinessResult =
  | { ok: true; verificationId: string }
  | { ok: false; errors: Array<{ index: number; message: string }> };

/**
 * Validates the submitted official links, reads what can lawfully be read,
 * assesses the evidence and stores a read-only verification record.
 * Records are written with the server's own access so users cannot forge them.
 */
export const verifyBusiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => verifyPayload.parse(input))
  .handler(async ({ data, context }): Promise<VerifyBusinessResult> => {
    const { supabase, userId } = context;

    const validation = validateSubmittedLinks(data.links);
    if (validation.errors.length > 0 || validation.sources.length === 0) {
      return { ok: false, errors: validation.errors.length ? validation.errors : [{ index: -1, message: "Add at least one official link for the business." }] };
    }

    if (data.previousVerificationId) {
      const { data: previous } = await supabase
        .from("business_verifications")
        .select("id")
        .eq("id", data.previousVerificationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!previous) throw new Error("The earlier verification could not be found.");
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("business_verifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    if ((count ?? 0) >= DAILY_VERIFICATION_LIMIT) {
      throw new Error(`You can run up to ${DAILY_VERIFICATION_LIMIT} verifications a day. Please try again tomorrow.`);
    }

    const filled = data.links.map((l) => l.trim()).filter(Boolean);
    const { retrieveSources } = await import("@/lib/verification/retrieve.server");
    const results = await retrieveSources(
      validation.sources.map((source, i) => ({ source, submittedUrl: filled[i] ?? source.normalizedUrl })),
    );

    const usable = results.filter((r) => r.retrievalStatus === "retrieved" || r.retrievalStatus === "url_checked");
    if (usable.length === 0) {
      return {
        ok: false,
        errors: results.map((r, index) => ({ index, message: r.errorMessage ?? "This link could not be opened." })),
      };
    }

    const assessment = assessVerification(results);
    const ownershipByType = new Map(assessment.ownership.map((o) => [o.type, o]));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("business_verifications")
      .insert({
        user_id: userId,
        previous_verification_id: data.previousVerificationId ?? null,
        business_name: assessment.businessName,
        website_domain: assessment.websiteDomain,
        confidence: assessment.confidence,
        verification_score: assessment.score,
        is_provisional: assessment.isProvisional,
        fields: assessment.fields as unknown as Json,
        conflicts: assessment.conflicts as unknown as Json,
        limitations: { notes: assessment.limitations, confidenceReasons: assessment.confidenceReasons } as unknown as Json,
        engine_version: assessment.engineVersion,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error("The verification could not be saved. Please try again.");

    const { error: sourcesError } = await supabaseAdmin.from("business_sources").insert(
      results.map((r, index) => {
        const own = ownershipByType.get(r.type);
        return {
          verification_id: row.id,
          user_id: userId,
          source_type: r.type,
          submitted_url: r.submittedUrl,
          normalized_url: r.normalizedUrl,
          final_url: r.finalUrl,
          retrieval_status: r.retrievalStatus,
          retrieval_method: r.retrievalMethod,
          http_status: r.httpStatus,
          ownership_link: own?.ownership ?? "not_checked",
          extracted: {
            identifier: r.identifier,
            placeName: r.placeName,
            pagesRead: r.pagesRead,
            facts: r.facts,
          } as unknown as Json,
          evidence: (own ? [{ kind: "ownership", detail: own.detail }] : []) as unknown as Json,
          error_message: r.errorMessage,
          sort_order: index,
        };
      }),
    );
    if (sourcesError) {
      await supabaseAdmin.from("business_verifications").delete().eq("id", row.id);
      throw new Error("The verification could not be saved. Please try again.");
    }

    await supabase.from("activity_events").insert({
      user_id: userId,
      event_type: "business_verified",
      metadata: { confidence: assessment.confidence, score: assessment.score, sources: results.map((r) => r.type) },
    });

    return { ok: true, verificationId: row.id };
  });

export const listVerifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("business_verifications")
      .select("id, business_name, website_domain, confidence, verification_score, is_provisional, created_at, previous_verification_id, fields, business_sources(source_type, retrieval_status)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getVerification = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ verificationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: verification, error } = await supabase
      .from("business_verifications")
      .select("*")
      .eq("id", data.verificationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!verification) return null;

    const sourcesFor = async (id: string) => {
      const { data: rows, error: e } = await supabase
        .from("business_sources")
        .select("*")
        .eq("verification_id", id)
        .order("sort_order", { ascending: true });
      if (e) throw new Error(e.message);
      return rows ?? [];
    };

    const sources = await sourcesFor(verification.id);

    // Walk back through earlier versions (history is never overwritten).
    const history: Array<Pick<VerificationRow, "id" | "created_at" | "confidence" | "verification_score" | "business_name">> = [];
    let previousSources: SourceRow[] | null = null;
    let cursor = verification.previous_verification_id;
    while (cursor && history.length < 20) {
      const { data: prev } = await supabase
        .from("business_verifications")
        .select("id, created_at, confidence, verification_score, business_name, previous_verification_id")
        .eq("id", cursor)
        .eq("user_id", userId)
        .maybeSingle();
      if (!prev) break;
      if (history.length === 0) previousSources = await sourcesFor(prev.id);
      history.push(prev);
      cursor = prev.previous_verification_id;
    }

    return { verification, sources, history, previousSources };
  });

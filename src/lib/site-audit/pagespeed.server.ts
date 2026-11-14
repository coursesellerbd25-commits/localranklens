/**
 * Google PageSpeed Insights API client (server-only). Results are cached in
 * the psi_cache table (service-role access) so repeated audits of the same
 * URL inside the TTL window do not hit Google again.
 */

import { cacheKeyForUrl } from "./url-guard";
import type { PsiOpportunity, PsiStrategyResult, PsiSummary, PsiMetricValue } from "./types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

interface LighthouseAudit {
  id?: string;
  title?: string;
  score?: number | null;
  numericValue?: number | null;
  displayValue?: string | null;
  details?: { type?: string };
}

interface LighthouseResponse {
  categories?: { performance?: { score?: number | null } };
  audits?: Record<string, LighthouseAudit>;
}

interface PsiApiResponse {
  error?: { message?: string };
  lighthouseResult?: LighthouseResponse;
}

async function psiRequest(url: string, strategy: "mobile" | "desktop"): Promise<PsiStrategyResult> {
  const apiKey = process.env["PAGESPEED_API_KEY"];
  if (!apiKey) {
    // Keyless requests are heavily rate-limited by Google, so we report the
    // missing configuration instead of returning unreliable or empty data.
    return {
      strategy,
      available: false,
      performanceScore: null,
      metrics: {},
      opportunities: [],
      error:
        "Performance not tested: the Google PageSpeed Insights API key has not been configured for this app yet.",
    };
  }
  const params = new URLSearchParams({ url, strategy, category: "performance", key: apiKey });

  try {
    const response = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(50_000),
      headers: { Accept: "application/json" },
    });

    if (response.status === 429) {
      return { strategy, available: false, performanceScore: null, metrics: {}, opportunities: [], error: "Google's PageSpeed rate limit was hit. Try again in a few minutes." };
    }
    if (response.status === 403) {
      const body = (await response.json().catch(() => null)) as PsiApiResponse | null;
      return { strategy, available: false, performanceScore: null, metrics: {}, opportunities: [], error: `PageSpeed Insights refused the request: ${body?.error?.message ?? "access denied"}` };
    }
    if (!response.ok) {
      return { strategy, available: false, performanceScore: null, metrics: {}, opportunities: [], error: `PageSpeed Insights returned status ${response.status}.` };
    }

    const body = (await response.json()) as PsiApiResponse;
    if (body.error) {
      return { strategy, available: false, performanceScore: null, metrics: {}, opportunities: [], error: body.error.message ?? "PageSpeed Insights returned an error." };
    }

    const lighthouse = body.lighthouseResult;
    const rawScore = lighthouse?.categories?.performance?.score ?? null;
    const audits = lighthouse?.audits ?? {};

    const metric = (id: string, unit: string): PsiMetricValue => {
      const audit = audits[id];
      return {
        value: typeof audit?.numericValue === "number" ? audit.numericValue : null,
        display: audit?.displayValue ?? null,
        score: typeof audit?.score === "number" ? audit.score : null,
        unit,
      };
    };

    const opportunities: PsiOpportunity[] = Object.values(audits)
      .filter((audit) => audit.details?.type === "opportunity" && typeof audit.numericValue === "number" && audit.numericValue > 0)
      .sort((a, b) => (b.numericValue ?? 0) - (a.numericValue ?? 0))
      .slice(0, 8)
      .map((audit) => ({ id: audit.id ?? "", title: audit.title ?? audit.id ?? "", displayValue: audit.displayValue ?? null }));

    return {
      strategy,
      available: true,
      performanceScore: typeof rawScore === "number" ? rawScore : null,
      metrics: {
        lcp: metric("largest-contentful-paint", "ms"),
        cls: metric("cumulative-layout-shift", "unitless"),
        inp: metric("interaction-to-next-paint", "ms"),
        fcp: metric("first-contentful-paint", "ms"),
        si: metric("speed-index", "ms"),
      },
      opportunities,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      strategy,
      available: false,
      performanceScore: null,
      metrics: {},
      opportunities: [],
      error: /timeout|abort/i.test(message)
        ? "Google's PageSpeed analysis timed out before returning results."
        : "PageSpeed Insights could not be reached for this run.",
    };
  }
}

function cacheKey(url: string, strategy: string): string {
  return `psi:${strategy}:${url}`;
}

async function readCache(url: string, strategy: "mobile" | "desktop"): Promise<PsiStrategyResult | null> {
  const { data } = await supabaseAdmin
    .from("psi_cache")
    .select("payload, fetched_at")
    .eq("cache_key", cacheKey(url, strategy))
    .maybeSingle();
  if (!data) return null;
  const fetchedAt = new Date(data.fetched_at as string).getTime();
  if (Number.isNaN(fetchedAt) || Date.now() - fetchedAt > CACHE_TTL_MS) return null;
  return data.payload as unknown as PsiStrategyResult;
}

async function writeCache(url: string, result: PsiStrategyResult): Promise<void> {
  if (!result.available) return;
  await supabaseAdmin.from("psi_cache").upsert({
    cache_key: cacheKey(url, result.strategy),
    payload: result as unknown as Json,
    fetched_at: new Date().toISOString(),
  });
}

/**
 * Runs PageSpeed for both strategies in parallel, using cached results when
 * they are fresh. Unavailable data is reported, never fabricated.
 */
export async function getPsiSummary(rawUrl: string): Promise<PsiSummary> {
  const key = cacheKeyForUrl(new URL(rawUrl));
  const [mobile, desktop] = await Promise.all([readCache(key, "mobile"), readCache(key, "desktop")]);

  const needed: Array<"mobile" | "desktop"> = [];
  if (!mobile) needed.push("mobile");
  if (!desktop) needed.push("desktop");

  const fetched = await Promise.all(needed.map((strategy) => psiRequest(key, strategy)));
  await Promise.all(fetched.map((result) => writeCache(key, result)));

  const byStrategy = (strategy: "mobile" | "desktop", cached: PsiStrategyResult | null): PsiStrategyResult | undefined => {
    if (cached) return cached;
    const fresh = fetched.find((result) => result.strategy === strategy);
    return fresh;
  };

  const mobileResult = byStrategy("mobile", mobile);
  const desktopResult = byStrategy("desktop", desktop);
  const errors = [mobileResult?.error, desktopResult?.error].filter(Boolean) as string[];

  return {
    available: Boolean(mobileResult?.available || desktopResult?.available),
    error: mobileResult?.available || desktopResult?.available ? undefined : errors[0] ?? "PageSpeed Insights data unavailable.",
    mobile: mobileResult,
    desktop: desktopResult,
  };
}

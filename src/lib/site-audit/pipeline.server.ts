/**
 * Server-only orchestration for the website SEO audit: guarded fetch of the
 * homepage, robots.txt, sitemap and a small sample of internal pages, plus
 * PageSpeed Insights, then the deterministic engines. Imported dynamically
 * inside the server function handler so it never reaches the client bundle.
 */

import { parsePage, robotsDisallows, sitemapUrlsFromRobots, looksLikeSitemapXml } from "./parse";
import { guardedFetch, guardedFetchLenient, fetchFailureMessage } from "./fetcher.server";
import { runWebsiteAudit, type SiteAuditData, type MainFetch } from "./engine";
import { runLocalReadiness, type LocalAuditInput } from "./local";
import { getPsiSummary } from "./pagespeed.server";
import { validateAndNormalizeUrl } from "./url-guard";
import type { CrawledPage, SiteAuditResult, LocalReadinessResult } from "./types";

export class SiteAuditError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|pdf|zip|rar|gz|mp3|mp4|webm|woff2?|ttf|eot|docx?|xlsx?|pptx?|txt|csv)$/i;
const MAX_SAMPLED_PAGES = 8;
const SAMPLE_TIMEOUT_MS = 9000;

export interface PipelineInput extends LocalAuditInput {
  url: string;
}

export interface PipelineResult {
  data: SiteAuditData;
  result: SiteAuditResult;
  local: LocalReadinessResult;
}

async function crawlSampledPages(links: string[], excludeUrl: string): Promise<CrawledPage[]> {
  const candidates = [...new Set(links)]
    .filter((link) => !SKIP_EXTENSIONS.test(new URL(link).pathname) && link !== excludeUrl)
    .slice(0, MAX_SAMPLED_PAGES);

  const crawl = async (url: string): Promise<CrawledPage> => {
    const result = await guardedFetchLenient(url, { timeoutMs: SAMPLE_TIMEOUT_MS, maxBytes: 300_000, requireHtml: true });
    if (result.ok) {
      let title: string | null = null;
      let metaDescription: string | null = null;
      try {
        const signals = parsePage(result.body, result.finalUrl);
        title = signals.title;
        metaDescription = signals.metaDescription;
      } catch {
        // Parsing a sampled page is best-effort; the status result still counts.
      }
      return { url, status: result.status, title, metaDescription, bytes: result.bytes };
    }
    return { url, status: result.status ?? null, title: null, metaDescription: null, bytes: null, error: result.kind };
  };

  const results: CrawledPage[] = [];
  const batchSize = 4;
  for (let i = 0; i < candidates.length; i += batchSize) {
    results.push(...(await Promise.all(candidates.slice(i, i + batchSize).map(crawl))));
  }
  return results;
}

export async function runWebsiteAuditPipeline(input: PipelineInput): Promise<PipelineResult> {
  const checked = validateAndNormalizeUrl(input.url);
  if (!checked.ok) throw new SiteAuditError(checked.userMessage);
  const requestedUrl = checked.url.toString();
  const origin = checked.url.origin;

  const [mainResult, robotsResult] = await Promise.all([
    guardedFetch(requestedUrl, { timeoutMs: 15000, maxBytes: 2_000_000 }),
    guardedFetchLenient(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 200_000 }),
  ]);

  if (!mainResult.ok) {
    throw new SiteAuditError(mainResult.userMessage);
  }

  const robotsContent = robotsResult.ok ? robotsResult.body : "";
  const robotsSitemap = robotsContent ? sitemapUrlsFromRobots(robotsContent)[0] ?? null : null;
  const sitemapUrl = robotsSitemap ?? `${origin}/sitemap.xml`;

  const signals = parsePage(mainResult.body, mainResult.finalUrl);
  const main: MainFetch = {
    requestedUrl,
    finalUrl: mainResult.finalUrl,
    status: mainResult.status,
    redirectChain: mainResult.redirectChain,
    signals,
    headers: mainResult.headers,
    bytes: mainResult.bytes,
    elapsedMs: mainResult.elapsedMs,
  };

  const robots = {
    available: robotsResult.ok && robotsResult.status === 200,
    status: robotsResult.ok ? robotsResult.status : null,
    disallowsHome: robotsContent ? robotsDisallows(robotsContent, checked.url.pathname || "/") : false,
    sitemapUrl: robotsSitemap,
  };

  const startedAt = Date.now();
  const [sitemapResult, subpages, psi] = await Promise.all([
    guardedFetchLenient(sitemapUrl, { timeoutMs: 8000, maxBytes: 500_000 }),
    crawlSampledPages(signals.internalLinks, requestedUrl),
    getPsiSummary(mainResult.finalUrl),
  ]);

  const data: SiteAuditData = {
    requestedUrl,
    main,
    robots,
    sitemap: {
      available: sitemapResult.ok && looksLikeSitemapXml(sitemapResult.body, sitemapResult.contentType),
      url: sitemapUrl,
      status: sitemapResult.ok ? sitemapResult.status : sitemapResult.status ?? null,
    },
    subpages,
    psi,
    totalElapsedMs: Date.now() - startedAt,
  };

  return {
    data,
    result: runWebsiteAudit(data),
    local: runLocalReadiness(data, {
      businessName: input.businessName || undefined,
      phone: input.phone || undefined,
      city: input.city || undefined,
      country: input.country || undefined,
    }),
  };
}

export { fetchFailureMessage };

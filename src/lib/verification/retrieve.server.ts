/**
 * Server-only retrieval for submitted business sources. Network access goes
 * through the guarded fetcher (SSRF-safe). Only public website pages are read;
 * Google, Facebook and LinkedIn pages are never scraped — their links are
 * format-checked and short links are expanded to read the place name.
 */

import { guardedFetch, resolveShortLink } from "@/lib/site-audit/fetcher.server";
import { contactPageCandidates, emptyFacts, extractWebsiteFacts } from "./extract";
import { classifySourceUrl, placeNameFromGoogleUrl, type ClassifiedSource } from "./sources";
import type { SourceResult } from "./assess";

const GOOGLE_DESTINATION = (url: URL) => /(^|\.)google\.[a-z.]{2,8}$/.test(url.hostname);
const FACEBOOK_DESTINATION = (url: URL) => /(^|\.)facebook\.com$/.test(url.hostname);

async function retrieveWebsite(source: ClassifiedSource, submittedUrl: string): Promise<SourceResult> {
  const base: Omit<SourceResult, "retrievalStatus" | "httpStatus" | "errorMessage" | "facts" | "finalUrl"> = {
    type: "website",
    submittedUrl,
    normalizedUrl: source.normalizedUrl,
    retrievalMethod: "public_website_fetch",
    identifier: source.identifier,
    placeName: null,
    pagesRead: [],
  };
  const page = await guardedFetch(source.normalizedUrl, { timeoutMs: 15000, maxBytes: 1_500_000 });
  if (!page.ok) {
    return {
      ...base,
      finalUrl: null,
      retrievalStatus: page.kind === "blocked_host" || page.kind === "invalid_url" ? "blocked" : "unreachable",
      httpStatus: page.status ?? null,
      errorMessage: page.userMessage,
      facts: null,
    };
  }
  const facts = extractWebsiteFacts(page.body, page.finalUrl, emptyFacts());
  const pagesRead = [page.finalUrl];
  // Contact details often live on a contact/about page — read up to two of them.
  if (facts.phones.length === 0 || facts.addresses.length === 0 || facts.emails.length === 0) {
    for (const extra of contactPageCandidates(page.body, page.finalUrl)) {
      const sub = await guardedFetch(extra, { timeoutMs: 8000, maxBytes: 800_000 });
      if (sub.ok) {
        extractWebsiteFacts(sub.body, sub.finalUrl, facts);
        pagesRead.push(sub.finalUrl);
      }
    }
  }
  return { ...base, finalUrl: page.finalUrl, retrievalStatus: "retrieved", httpStatus: page.status, errorMessage: null, facts, pagesRead };
}

async function retrieveLinkOnly(source: ClassifiedSource, submittedUrl: string): Promise<SourceResult> {
  const result: SourceResult = {
    type: source.type,
    submittedUrl,
    normalizedUrl: source.normalizedUrl,
    finalUrl: null,
    retrievalStatus: "url_checked",
    retrievalMethod: "url_pattern",
    httpStatus: null,
    errorMessage: null,
    identifier: source.type === "facebook" || source.type === "linkedin" ? source.identifier : null,
    placeName: source.type === "google_maps" || source.type === "google_business_profile" ? placeNameFromGoogleUrl(source.normalizedUrl) : null,
    facts: null,
    pagesRead: [],
  };
  if (!source.isShortLink) return result;

  const stop = source.type === "facebook" ? FACEBOOK_DESTINATION : GOOGLE_DESTINATION;
  const expanded = await resolveShortLink(source.normalizedUrl, stop);
  if (!expanded.ok) {
    return { ...result, retrievalStatus: "unreachable", httpStatus: expanded.status ?? null, errorMessage: expanded.kind === "http_404" ? "This short link doesn't lead to a listing any more." : expanded.userMessage };
  }
  const reclassified = classifySourceUrl(expanded.finalUrl);
  const finalUrl = expanded.finalUrl;
  if (source.type === "facebook") {
    return {
      ...result,
      finalUrl,
      retrievalMethod: "redirect_resolution",
      identifier: reclassified.ok && reclassified.type === "facebook" ? reclassified.identifier : result.identifier,
    };
  }
  if (!GOOGLE_DESTINATION(new URL(finalUrl))) {
    return { ...result, retrievalStatus: "unreachable", errorMessage: "This short link doesn't lead to a Google listing." };
  }
  return { ...result, finalUrl, retrievalMethod: "redirect_resolution", placeName: placeNameFromGoogleUrl(finalUrl) };
}

export async function retrieveSources(sources: Array<{ source: ClassifiedSource; submittedUrl: string }>): Promise<SourceResult[]> {
  return Promise.all(
    sources.map(({ source, submittedUrl }) =>
      source.type === "website" ? retrieveWebsite(source, submittedUrl) : retrieveLinkOnly(source, submittedUrl),
    ),
  );
}

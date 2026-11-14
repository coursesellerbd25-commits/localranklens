/**
 * Official business source links: URL validation and source-type detection.
 * Pure — runs in the browser (instant feedback) and again on the server
 * (the server result is the only one that counts).
 */

import { validateAndNormalizeUrl } from "@/lib/site-audit/url-guard";

export const SOURCE_TYPES = [
  "website",
  "google_business_profile",
  "google_maps",
  "facebook",
  "linkedin",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_LABELS: Record<SourceType, string> = {
  website: "Official website",
  google_business_profile: "Google Business Profile",
  google_maps: "Google Maps listing",
  facebook: "Facebook page",
  linkedin: "LinkedIn company page",
};

export const MAX_SOURCES = 5;

export interface ClassifiedSource {
  ok: true;
  type: SourceType;
  normalizedUrl: string;
  /** Page slug / company slug / place name hint taken from the URL itself. */
  identifier: string | null;
  /** True for short links (maps.app.goo.gl, g.page …) that must be expanded server-side. */
  isShortLink: boolean;
}

export interface SourceError {
  ok: false;
  message: string;
}

export type SourceCheck = ClassifiedSource | SourceError;

const GOOGLE_HOST = /^(www\.)?google\.[a-z.]{2,8}$/;
const MAPS_HOST = /^maps\.google\.[a-z.]{2,8}$/;
const MAPS_SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const GBP_SHORT_HOSTS = new Set(["g.page", "g.co", "share.google"]);
const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "business.facebook.com", "fb.com", "www.fb.com", "fb.me"]);
const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com", "uk.linkedin.com", "m.linkedin.com"]);

/** Third-party sites that are not a business's own website or a supported profile. */
const NOT_OFFICIAL: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(twitter|x)\.com$/, "X (Twitter)"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)yelp\.[a-z.]+$/, "Yelp"],
  [/(^|\.)tripadvisor\.[a-z.]+$/, "Tripadvisor"],
  [/(^|\.)trustpilot\.com$/, "Trustpilot"],
  [/(^|\.)yell\.com$/, "Yell"],
  [/(^|\.)checkatrade\.com$/, "Checkatrade"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)apple\.com$/, "Apple"],
  [/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/, "WhatsApp"],
  [/(^|\.)pinterest\.[a-z.]+$/, "Pinterest"],
];

const FACEBOOK_NON_PAGES = new Set([
  "sharer", "sharer.php", "share", "login", "login.php", "groups", "events", "watch", "marketplace",
  "gaming", "search", "hashtag", "help", "policies", "privacy", "photo", "photo.php", "story.php",
  "permalink.php", "home.php", "dialog", "plugins", "reel", "reels", "stories", "messages", "notifications",
]);

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " ")).trim();
  } catch {
    return value.trim();
  }
}

/** Place name hint from an expanded Google Maps / Search URL, if the URL contains one. */
export function placeNameFromGoogleUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const place = url.pathname.match(/\/maps\/place\/([^/@]+)/);
  if (place?.[1]) return decodeSegment(place[1]) || null;
  const search = url.pathname.match(/\/maps\/search\/([^/@]+)/);
  if (search?.[1]) return decodeSegment(search[1]) || null;
  const q = url.searchParams.get("q") ?? url.searchParams.get("query");
  if (q && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q.trim())) return q.trim();
  return null;
}

export function classifySourceUrl(raw: string): SourceCheck {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, message: "Paste a link." };
  if (trimmed.length > 2048) return { ok: false, message: "That link is too long." };

  const checked = validateAndNormalizeUrl(trimmed);
  if (!checked.ok) return { ok: false, message: checked.userMessage };
  const url = checked.url;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  // ---- Google: Business Profile and Maps ----
  if (MAPS_SHORT_HOSTS.has(host)) {
    if (host === "goo.gl" && segments[0] !== "maps") {
      return { ok: false, message: "Only goo.gl/maps short links are accepted from goo.gl." };
    }
    if (segments.length === 0) return { ok: false, message: "This short link is incomplete." };
    return { ok: true, type: "google_maps", normalizedUrl: url.toString(), identifier: null, isShortLink: true };
  }
  if (GBP_SHORT_HOSTS.has(host)) {
    if (segments.length === 0) return { ok: false, message: "This short link is incomplete." };
    if (host === "g.co" && segments[0] !== "kgs") {
      return { ok: false, message: "Only g.co/kgs business links are accepted from g.co." };
    }
    return { ok: true, type: "google_business_profile", normalizedUrl: url.toString(), identifier: host === "g.page" ? (segments[0] ?? null) : null, isShortLink: true };
  }
  if (host === "business.google.com") {
    return { ok: true, type: "google_business_profile", normalizedUrl: url.toString(), identifier: null, isShortLink: false };
  }
  if (MAPS_HOST.test(host) || (GOOGLE_HOST.test(host) && segments[0] === "maps")) {
    const hasPlace = /\/maps\/(place|search)\//.test(path) || url.searchParams.has("cid") || url.searchParams.has("q") || url.searchParams.has("query") || url.searchParams.has("query_place_id");
    if (!hasPlace) {
      return { ok: false, message: "This Google Maps link doesn't point to a business. Open the business on Maps and use Share → Copy link." };
    }
    return { ok: true, type: "google_maps", normalizedUrl: url.toString(), identifier: placeNameFromGoogleUrl(url.toString()), isShortLink: false };
  }
  if (GOOGLE_HOST.test(host) && segments[0] === "search") {
    if (!url.searchParams.has("kgmid") && !url.searchParams.has("ludocid") && !url.searchParams.has("q")) {
      return { ok: false, message: "This Google search link doesn't identify a business profile." };
    }
    return { ok: true, type: "google_business_profile", normalizedUrl: url.toString(), identifier: placeNameFromGoogleUrl(url.toString()), isShortLink: false };
  }
  if (GOOGLE_HOST.test(host) || host.endsWith(".google.com")) {
    return { ok: false, message: "This Google link isn't a business profile or Maps listing." };
  }

  // ---- Facebook ----
  if (FACEBOOK_HOSTS.has(host)) {
    if (host === "fb.me") {
      if (!segments[0]) return { ok: false, message: "This Facebook short link is incomplete." };
      return { ok: true, type: "facebook", normalizedUrl: url.toString(), identifier: segments[0].toLowerCase(), isShortLink: true };
    }
    const first = (segments[0] ?? "").toLowerCase();
    if (first === "profile.php") {
      const id = url.searchParams.get("id");
      if (!id || !/^\d+$/.test(id)) return { ok: false, message: "This Facebook link is missing the page ID." };
      return { ok: true, type: "facebook", normalizedUrl: `https://www.facebook.com/profile.php?id=${id}`, identifier: id, isShortLink: false };
    }
    if (!first) return { ok: false, message: "Paste the link to the business's Facebook page, not the Facebook homepage." };
    if (FACEBOOK_NON_PAGES.has(first)) {
      return { ok: false, message: "This is a Facebook post, group or share link. Paste the business's Facebook page link instead." };
    }
    const slug = first === "pages" ? (segments[segments.length - 1] ?? "").toLowerCase() : first;
    if (!slug) return { ok: false, message: "This Facebook link doesn't identify a page." };
    return { ok: true, type: "facebook", normalizedUrl: `https://www.facebook.com/${segments.slice(0, first === "pages" ? 3 : 1).join("/")}`, identifier: slug, isShortLink: false };
  }

  // ---- LinkedIn ----
  if (LINKEDIN_HOSTS.has(host)) {
    const first = (segments[0] ?? "").toLowerCase();
    if (first === "in") {
      return { ok: false, message: "This is a personal LinkedIn profile. Paste the business's LinkedIn company page instead." };
    }
    if ((first === "company" || first === "school" || first === "showcase") && segments[1]) {
      const slug = segments[1].toLowerCase();
      return { ok: true, type: "linkedin", normalizedUrl: `https://www.linkedin.com/${first}/${slug}`, identifier: slug, isShortLink: false };
    }
    return { ok: false, message: "Paste the business's LinkedIn company page (linkedin.com/company/…)." };
  }

  // ---- Everything else must be the business's own website ----
  for (const [pattern, name] of NOT_OFFICIAL) {
    if (pattern.test(host)) {
      return { ok: false, message: `This is a ${name} page. Accepted links are the official website, Google Business Profile, Google Maps, Facebook page or LinkedIn company page.` };
    }
  }
  return {
    ok: true,
    type: "website",
    normalizedUrl: `${url.origin}${url.pathname}`,
    identifier: host.replace(/^www\./, ""),
    isShortLink: false,
  };
}

export interface SubmittedLinksResult {
  sources: ClassifiedSource[];
  errors: Array<{ index: number; message: string }>;
}

/** Validates the full set of submitted links: at least one valid, max one per type. */
export function validateSubmittedLinks(links: string[]): SubmittedLinksResult {
  const filled = links.map((link) => (link ?? "").trim());
  const errors: SubmittedLinksResult["errors"] = [];
  const sources: ClassifiedSource[] = [];
  const seen = new Map<SourceType, number>();

  if (filled.filter(Boolean).length > MAX_SOURCES) {
    errors.push({ index: -1, message: `You can submit up to ${MAX_SOURCES} links.` });
  }

  filled.forEach((link, index) => {
    if (!link) return;
    const result = classifySourceUrl(link);
    if (!result.ok) {
      errors.push({ index, message: result.message });
      return;
    }
    const earlier = seen.get(result.type);
    if (earlier !== undefined) {
      errors.push({ index, message: `You already added a ${SOURCE_LABELS[result.type]} link. Use one link per type.` });
      return;
    }
    seen.set(result.type, index);
    sources.push(result);
  });

  if (filled.filter(Boolean).length === 0) {
    errors.push({ index: -1, message: "Add at least one official link for the business." });
  }
  return { sources, errors };
}

/**
 * Pulls business facts out of a fetched website page. Every value carries how
 * it was found so reports can show the evidence. Nothing is guessed: a fact
 * that isn't on the page is simply absent.
 */

import { parse, type HTMLElement } from "node-html-parser";

export type ExtractionMethod = "structured_data" | "meta_tag" | "page_link" | "page_markup";

export interface Fact<T = string> {
  value: T;
  method: ExtractionMethod;
  pageUrl: string;
  detail: string;
}

export interface PostalAddress {
  street: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  formatted: string;
}

export interface SocialLink {
  network: "facebook" | "linkedin" | "instagram" | "x" | "youtube" | "tiktok" | "google_maps";
  url: string;
  /** facebook page slug / linkedin company slug / maps place hint */
  identifier: string | null;
}

export interface WebsiteFacts {
  names: Fact[];
  phones: Fact[];
  emails: Fact[];
  addresses: Fact<PostalAddress>[];
  categories: Fact[];
  descriptions: Fact[];
  hours: Fact[];
  services: Fact[];
  areasServed: Fact[];
  socialLinks: Array<Fact<SocialLink>>;
  structuredDataFound: boolean;
}

export function emptyFacts(): WebsiteFacts {
  return {
    names: [],
    phones: [],
    emails: [],
    addresses: [],
    categories: [],
    descriptions: [],
    hours: [],
    services: [],
    areasServed: [],
    socialLinks: [],
    structuredDataFound: false,
  };
}

/** Schema.org types too generic to count as a business category. */
const GENERIC_TYPES = new Set([
  "thing", "organization", "localbusiness", "website", "webpage", "webSite", "corporation", "place",
  "breadcrumblist", "listitem", "imageobject", "searchaction", "person", "postaladdress", "offer",
  "aggregaterating", "review", "rating", "openinghoursspecification", "geocoordinates", "contactpoint",
  "sitenavigationelement", "wpheader", "wpfooter", "article", "blogposting", "faqpage", "question",
  "answer", "service", "product", "offercatalog", "videoobject", "collectionpage", "aboutpage", "contactpage",
  "readaction", "entrypoint", "professionalservice", "homeandconstructionbusiness",
]);

const BUSINESS_TYPE_HINT = /business|organization|store|shop|restaurant|service|clinic|dentist|plumber|electrician|contractor|agency|office|hotel|salon|cafe|bar|bakery|attorney|lawyer|physician|repair|dealer|school|gym|spa|locksmith|roofing|hvac|moving|cleaning|realestate|accounting|insurance|veterinary|pharmacy|optician|florist|club|center|centre/i;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    return trimmed || null;
  }
  if (typeof value === "number") return String(value);
  return null;
}

function typesOf(node: Record<string, unknown>): string[] {
  return asArray(node["@type"] as string | string[]).filter((t): t is string => typeof t === "string");
}

function collectNodes(data: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(data)) {
    for (const item of data) collectNodes(item, out);
    return;
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    out.push(record);
    if (Array.isArray(record["@graph"])) collectNodes(record["@graph"], out);
  }
}

function isBusinessNode(node: Record<string, unknown>): boolean {
  const types = typesOf(node).map((t) => t.toLowerCase());
  if (types.length === 0) return false;
  if (types.includes("localbusiness") || types.includes("organization") || types.includes("corporation")) return true;
  return types.some((t) => !GENERIC_TYPES.has(t) && BUSINESS_TYPE_HINT.test(t)) || types.some((t) => t === "professionalservice" || t === "homeandconstructionbusiness");
}

function parseAddress(value: unknown): PostalAddress | null {
  if (typeof value === "string") {
    const formatted = str(value);
    return formatted ? { street: null, locality: null, region: null, postalCode: null, country: null, formatted } : null;
  }
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  const country = a["addressCountry"];
  const address: PostalAddress = {
    street: str(a["streetAddress"]),
    locality: str(a["addressLocality"]),
    region: str(a["addressRegion"]),
    postalCode: str(a["postalCode"]),
    country: typeof country === "object" && country ? str((country as Record<string, unknown>)["name"]) : str(country),
    formatted: "",
  };
  address.formatted = [address.street, address.locality, address.region, address.postalCode, address.country]
    .filter(Boolean)
    .join(", ");
  return address.formatted ? address : null;
}

function hoursFrom(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const entry of asArray(node["openingHours"] as string | string[])) {
    const text = str(entry);
    if (text) out.push(text);
  }
  for (const spec of asArray(node["openingHoursSpecification"] as Record<string, unknown> | Record<string, unknown>[])) {
    if (!spec || typeof spec !== "object") continue;
    const days = asArray(spec["dayOfWeek"] as string | string[])
      .map((d) => (typeof d === "string" ? d.replace(/^https?:\/\/schema\.org\//, "") : ""))
      .filter(Boolean);
    const opens = str(spec["opens"]);
    const closes = str(spec["closes"]);
    if (days.length && opens && closes) out.push(`${days.join(", ")} ${opens}–${closes}`);
  }
  return out;
}

function servicesFrom(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  const catalog = node["hasOfferCatalog"] as Record<string, unknown> | undefined;
  const offers = [...asArray(node["makesOffer"] as unknown[]), ...asArray(catalog?.["itemListElement"] as unknown[])];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const o = offer as Record<string, unknown>;
    const item = (o["itemOffered"] as Record<string, unknown> | undefined) ?? o;
    const name = str(item["name"]);
    if (name) out.push(name);
  }
  return out;
}

function areaFrom(node: Record<string, unknown>): string[] {
  return asArray(node["areaServed"] as unknown[])
    .map((a) => (typeof a === "string" ? str(a) : a && typeof a === "object" ? str((a as Record<string, unknown>)["name"]) : null))
    .filter((a): a is string => Boolean(a));
}

/** Classifies a link to a social network or Google Maps found on the website. */
export function socialLinkFrom(href: string): SocialLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|web)\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const first = (segments[0] ?? "").toLowerCase();
  if (host === "facebook.com" || host === "fb.com") {
    if (!first || ["sharer", "sharer.php", "share", "dialog", "plugins", "tr"].includes(first)) return null;
    if (first === "profile.php") {
      const id = url.searchParams.get("id");
      return id ? { network: "facebook", url: url.toString(), identifier: id } : null;
    }
    const slug = first === "pages" ? (segments[segments.length - 1] ?? "").toLowerCase() : first;
    return { network: "facebook", url: url.toString(), identifier: slug || null };
  }
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    if ((first === "company" || first === "school" || first === "showcase") && segments[1]) {
      return { network: "linkedin", url: url.toString(), identifier: segments[1].toLowerCase() };
    }
    return null;
  }
  if (host === "instagram.com") return first ? { network: "instagram", url: url.toString(), identifier: first.toLowerCase() } : null;
  if (host === "twitter.com" || host === "x.com") {
    return first && !["share", "intent", "home"].includes(first) ? { network: "x", url: url.toString(), identifier: first.toLowerCase() } : null;
  }
  if (host === "youtube.com" || host === "youtu.be") return { network: "youtube", url: url.toString(), identifier: null };
  if (host === "tiktok.com") return first ? { network: "tiktok", url: url.toString(), identifier: first.toLowerCase() } : null;
  if (host === "maps.app.goo.gl" || host === "g.page" || (host === "goo.gl" && first === "maps") || /^maps\.google\./.test(host) || (/^google\.[a-z.]+$/.test(host) && first === "maps")) {
    return { network: "google_maps", url: url.toString(), identifier: null };
  }
  return null;
}

function titleName(title: string | null): string | null {
  if (!title) return null;
  const parts = title.split(/\s[|–—•:·-]\s|\|/).map((p) => p.trim()).filter(Boolean);
  const first = parts.find((p) => !/^(home|homepage|home page|welcome|index|official site|official website)$/i.test(p));
  return first && first.length >= 2 && first.length <= 80 ? first : null;
}

function pushUnique<T>(list: Fact<T>[], fact: Fact<T>, key: (v: T) => string): void {
  const k = key(fact.value).toLowerCase();
  if (!list.some((existing) => key(existing.value).toLowerCase() === k)) list.push(fact);
}

/** Extracts business facts from one HTML page. */
export function extractWebsiteFacts(html: string, pageUrl: string, into: WebsiteFacts = emptyFacts()): WebsiteFacts {
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: true, pre: true } });
  const facts = into;
  const id = (s: string) => s;

  // ---- JSON-LD structured data ----
  const nodes: Record<string, unknown>[] = [];
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      collectNodes(JSON.parse((script.text ?? "").trim()), nodes);
    } catch {
      // Malformed JSON-LD is ignored.
    }
  }
  for (const node of nodes.filter(isBusinessNode)) {
    facts.structuredDataFound = true;
    const detail = `JSON-LD ${typesOf(node).join("/")}`;
    const name = str(node["name"]) ?? str(node["legalName"]);
    if (name) pushUnique(facts.names, { value: name, method: "structured_data", pageUrl, detail }, id);
    for (const t of typesOf(node)) {
      if (!GENERIC_TYPES.has(t.toLowerCase())) {
        pushUnique(facts.categories, { value: t.replace(/([a-z])([A-Z])/g, "$1 $2"), method: "structured_data", pageUrl, detail }, id);
      }
    }
    for (const phone of asArray(node["telephone"] as string | string[])) {
      const value = str(phone);
      if (value) pushUnique(facts.phones, { value, method: "structured_data", pageUrl, detail }, (v) => v.replace(/\D/g, ""));
    }
    const email = str(node["email"]);
    if (email) pushUnique(facts.emails, { value: email.replace(/^mailto:/i, ""), method: "structured_data", pageUrl, detail }, id);
    for (const addr of asArray(node["address"] as unknown[])) {
      const parsed = parseAddress(addr);
      if (parsed) pushUnique(facts.addresses, { value: parsed, method: "structured_data", pageUrl, detail }, (v) => v.formatted);
    }
    const description = str(node["description"]);
    if (description) pushUnique(facts.descriptions, { value: description.slice(0, 750), method: "structured_data", pageUrl, detail }, id);
    for (const h of hoursFrom(node)) pushUnique(facts.hours, { value: h, method: "structured_data", pageUrl, detail }, id);
    for (const s of servicesFrom(node)) pushUnique(facts.services, { value: s, method: "structured_data", pageUrl, detail }, id);
    for (const a of areaFrom(node)) pushUnique(facts.areasServed, { value: a, method: "structured_data", pageUrl, detail }, id);
    for (const same of asArray(node["sameAs"] as string | string[])) {
      if (typeof same !== "string") continue;
      const link = socialLinkFrom(same);
      if (link) pushUnique(facts.socialLinks, { value: link, method: "structured_data", pageUrl, detail: `${detail} sameAs` }, (v) => v.url);
    }
  }

  // ---- Meta tags ----
  const meta = (selector: string) => root.querySelector(selector)?.getAttribute("content")?.trim() || null;
  const siteName = meta('meta[property="og:site_name"]');
  if (siteName) pushUnique(facts.names, { value: siteName, method: "meta_tag", pageUrl, detail: "og:site_name" }, id);
  const fromTitle = titleName(root.querySelector("title")?.text?.trim() ?? null);
  if (fromTitle) pushUnique(facts.names, { value: fromTitle, method: "meta_tag", pageUrl, detail: "<title>" }, id);
  const description = meta('meta[name="description"]') ?? meta('meta[property="og:description"]');
  if (description) pushUnique(facts.descriptions, { value: description.slice(0, 750), method: "meta_tag", pageUrl, detail: "meta description" }, id);

  // ---- Links on the page ----
  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = (anchor.getAttribute("href") ?? "").trim();
    if (/^tel:/i.test(href)) {
      const value = decodeURIComponent(href.replace(/^tel:/i, "")).trim();
      if (value.replace(/\D/g, "").length >= 7) {
        pushUnique(facts.phones, { value, method: "page_link", pageUrl, detail: `tel: link (${value})` }, (v) => v.replace(/\D/g, ""));
      }
      continue;
    }
    if (/^mailto:/i.test(href)) {
      const value = decodeURIComponent(href.replace(/^mailto:/i, "").split("?")[0] ?? "").trim();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) pushUnique(facts.emails, { value, method: "page_link", pageUrl, detail: "mailto: link" }, id);
      continue;
    }
    let absolute: string;
    try {
      absolute = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    const link = socialLinkFrom(absolute);
    if (link) pushUnique(facts.socialLinks, { value: link, method: "page_link", pageUrl, detail: "link on page" }, (v) => v.url);
  }
  for (const frame of root.querySelectorAll("iframe[src]")) {
    const src = frame.getAttribute("src") ?? "";
    if (/google\.[a-z.]+\/maps/.test(src)) {
      try {
        pushUnique(facts.socialLinks, { value: { network: "google_maps", url: new URL(src, pageUrl).toString(), identifier: null }, method: "page_markup", pageUrl, detail: "embedded Google map" }, (v) => v.url);
      } catch {
        // ignore malformed iframe src
      }
    }
  }

  // ---- <address> markup (not machine-readable, recorded separately) ----
  const addressEl = root.querySelector("address") as HTMLElement | null;
  const addressText = addressEl?.text?.replace(/\s+/g, " ").trim();
  if (addressText && addressText.length >= 8 && addressText.length <= 300) {
    pushUnique(facts.addresses, { value: { street: null, locality: null, region: null, postalCode: null, country: null, formatted: addressText }, method: "page_markup", pageUrl, detail: "<address> element" }, (v) => v.formatted);
  }

  return facts;
}

/** Internal pages likely to hold contact details (contact / about / location). */
export function contactPageCandidates(html: string, pageUrl: string): string[] {
  const root = parse(html);
  const base = new URL(pageUrl);
  const out: string[] = [];
  for (const anchor of root.querySelectorAll("a[href]")) {
    try {
      const url = new URL(anchor.getAttribute("href") ?? "", base);
      if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      if (!/(contact|about|location|find-us|visit|branches)/i.test(url.pathname)) continue;
      const clean = `${url.origin}${url.pathname}`;
      if (clean !== `${base.origin}${base.pathname}` && !out.includes(clean)) out.push(clean);
    } catch {
      // ignore
    }
  }
  return out.slice(0, 2);
}

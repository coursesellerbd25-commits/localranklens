/**
 * Turns retrieved source evidence into the verified business record:
 * per-field verification status, cross-source conflicts, a confidence level
 * and the Business Information Verification score. Pure and deterministic.
 *
 * Anti-manipulation rules:
 * - A link only earns credit when something was actually retrieved or
 *   corroborated; submitting more links does not raise confidence by itself.
 * - "Verified" needs two independent sources agreeing; one source = partial.
 * - Conflicts cap confidence at Low and score nothing for that field.
 */

import type { Fact, PostalAddress, SocialLink, WebsiteFacts } from "./extract";
import type { SourceType } from "./sources";

export const VERIFICATION_ENGINE_VERSION = "bv1";

export type FieldStatus = "verified" | "partial" | "unverified" | "conflicting" | "unavailable";
export type Confidence = "high" | "medium" | "low";
export type RetrievalStatus = "retrieved" | "url_checked" | "unreachable" | "blocked";
export type OwnershipLink = "confirmed" | "mismatch" | "not_found" | "not_checked";

export interface SourceResult {
  type: SourceType;
  submittedUrl: string;
  normalizedUrl: string;
  finalUrl: string | null;
  retrievalStatus: RetrievalStatus;
  retrievalMethod: "public_website_fetch" | "url_pattern" | "redirect_resolution";
  httpStatus: number | null;
  errorMessage: string | null;
  /** Page slug / company slug taken from the link itself. */
  identifier: string | null;
  /** Place name inside an (expanded) Google link, e.g. /maps/place/<name>. */
  placeName: string | null;
  /** Only for websites that were fetched. */
  facts: WebsiteFacts | null;
  pagesRead: string[];
}

export interface FieldEvidence {
  sourceType: SourceType | "derived";
  method: string;
  pageUrl: string | null;
  detail: string;
}

export interface VerifiedField<T = string> {
  value: T | null;
  status: FieldStatus;
  evidence: FieldEvidence[];
  note: string;
  alternatives?: T[];
}

export interface VerifiedFields {
  name: VerifiedField;
  website: VerifiedField;
  category: VerifiedField;
  description: VerifiedField;
  address: VerifiedField;
  city: VerifiedField;
  serviceAreas: VerifiedField<string[]>;
  phone: VerifiedField;
  email: VerifiedField;
  hours: VerifiedField<string[]>;
  services: VerifiedField<string[]>;
  socialProfiles: VerifiedField<string[]>;
}

export const FIELD_LABELS: Record<keyof VerifiedFields, string> = {
  name: "Business name",
  website: "Website",
  category: "Business category",
  description: "Description",
  address: "Address",
  city: "Town / city",
  serviceAreas: "Service areas",
  phone: "Phone",
  email: "Email",
  hours: "Opening hours",
  services: "Services",
  socialProfiles: "Social profiles",
};

export interface Conflict {
  kind: "different_business" | "name_mismatch" | "profile_link_mismatch" | "phone_mismatch" | "unreachable_source";
  severity: "high" | "medium" | "low";
  message: string;
  sources: SourceType[];
}

export interface SourceOwnership {
  type: SourceType;
  ownership: OwnershipLink;
  detail: string;
}

export interface VerificationAssessment {
  engineVersion: string;
  fields: VerifiedFields;
  conflicts: Conflict[];
  ownership: SourceOwnership[];
  confidence: Confidence;
  confidenceReasons: string[];
  score: number;
  isProvisional: boolean;
  limitations: string[];
  businessName: string | null;
  websiteDomain: string | null;
}

/** Points per field in the Business Information Verification score (sum = 100). */
export const FIELD_WEIGHTS: Partial<Record<keyof VerifiedFields, number>> = {
  name: 20,
  address: 15,
  phone: 15,
  website: 10,
  category: 10,
  hours: 10,
  email: 5,
  description: 5,
  services: 5,
  socialProfiles: 5,
};

const STATUS_CREDIT: Record<FieldStatus, number> = {
  verified: 1,
  partial: 0.5,
  unverified: 0,
  conflicting: 0,
  unavailable: 0,
};

const LEGAL_SUFFIXES = /\b(ltd|limited|llc|inc|incorporated|plc|co|company|corp|corporation|gmbh|pty|llp|lp|the|and|&)\b/g;

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compact(value: string): string {
  return normaliseName(value).replace(/\s+/g, "");
}

/** True when two business names plausibly refer to the same business. */
export function namesMatch(a: string, b: string): boolean {
  const ca = compact(a);
  const cb = compact(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.length >= 4 && cb.length >= 4 && (ca.includes(cb) || cb.includes(ca))) return true;
  const ta = new Set(normaliseName(a).split(" ").filter((t) => t.length > 1));
  const tb = new Set(normaliseName(b).split(" ").filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.6;
}

/** True when a page slug (facebook.com/joesplumbingleeds) plausibly matches a name. */
export function slugMatchesName(slug: string, name: string): boolean {
  const s = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = compact(name);
  if (!s || !n || /^\d+$/.test(s)) return false;
  if (s.includes(n) || (s.length >= 5 && n.includes(s))) return true;
  const tokens = normaliseName(name).split(" ").filter((t) => t.length >= 3);
  return tokens.length > 0 && tokens.filter((t) => s.includes(t)).length / tokens.length >= 0.6;
}

export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}

function evidenceOf<T>(fact: Fact<T>): FieldEvidence {
  return { sourceType: "website", method: fact.method, pageUrl: fact.pageUrl, detail: fact.detail };
}

function unavailable<T>(note: string): VerifiedField<T> {
  return { value: null, status: "unavailable", evidence: [], note };
}

function singleWebsiteField(facts: WebsiteFacts | null, list: Fact[] | undefined, label: string): VerifiedField {
  if (!facts) return unavailable(`No website was read, so the ${label} could not be checked.`);
  const best = (list ?? []).find((f) => f.method === "structured_data") ?? list?.[0];
  if (!best) return unavailable(`No ${label} was found on the website.`);
  return {
    value: best.value,
    status: best.method === "page_markup" ? "unverified" : "partial",
    evidence: (list ?? []).slice(0, 3).map(evidenceOf),
    note: best.method === "page_markup" ? "Seen on the page but not in a machine-readable format." : "Found on the official website only — not yet confirmed by a second source.",
  };
}

function listWebsiteField(facts: WebsiteFacts | null, list: Fact[] | undefined, label: string): VerifiedField<string[]> {
  if (!facts) return unavailable(`No website was read, so ${label} could not be checked.`);
  if (!list || list.length === 0) return unavailable(`No ${label} were found in the website's structured data.`);
  return {
    value: list.slice(0, 20).map((f) => f.value),
    status: "partial",
    evidence: list.slice(0, 3).map(evidenceOf),
    note: "Found on the official website only — not yet confirmed by a second source.",
  };
}

function idMatches(link: SocialLink, identifier: string | null): boolean {
  return Boolean(identifier && link.identifier && link.identifier.toLowerCase() === identifier.toLowerCase());
}

export function assessVerification(sources: SourceResult[]): VerificationAssessment {
  const conflicts: Conflict[] = [];
  const limitations: string[] = [];
  const ownership: SourceOwnership[] = [];
  const reasons: string[] = [];

  const website = sources.find((s) => s.type === "website") ?? null;
  const facts = website?.retrievalStatus === "retrieved" ? website.facts : null;
  const mapsLike = sources.filter((s) => s.type === "google_maps" || s.type === "google_business_profile");
  const socials = sources.filter((s) => s.type === "facebook" || s.type === "linkedin");

  for (const s of sources) {
    if (s.retrievalStatus === "unreachable" || s.retrievalStatus === "blocked") {
      conflicts.push({
        kind: "unreachable_source",
        severity: "low",
        message: `${s.type === "website" ? "The website" : "A submitted link"} could not be opened: ${(s.errorMessage ?? "no response").replace(/\.$/, "")}. Nothing from it was used.`,
        sources: [s.type],
      });
    }
  }

  // ---------- Business name ----------
  const websiteNames = facts?.names ?? [];
  const strongName = websiteNames.find((n) => n.method === "structured_data") ?? websiteNames.find((n) => n.detail === "og:site_name") ?? websiteNames[0] ?? null;
  const placeHints = mapsLike.filter((s) => Boolean(s.placeName));
  let name: VerifiedField;
  if (strongName) {
    const evidence: FieldEvidence[] = [evidenceOf(strongName)];
    let status: FieldStatus = "partial";
    let note = "Found on the official website only — not yet confirmed by a second source.";
    const agreeing: SourceType[] = [];
    const disagreeing: Array<{ type: SourceType; value: string }> = [];
    const reliableName = strongName.method === "structured_data" || strongName.detail === "og:site_name";
    for (const hint of placeHints) {
      if (websiteNames.some((n) => namesMatch(n.value, hint.placeName ?? ""))) agreeing.push(hint.type);
      else disagreeing.push({ type: hint.type, value: hint.placeName ?? "" });
    }
    if (disagreeing.length > 0) {
      status = "conflicting";
      note = `The website says "${strongName.value}" but the ${disagreeing.map((d) => (d.type === "google_maps" ? "Google Maps link" : "Google link")).join(" and ")} names "${disagreeing[0]?.value}".`;
      conflicts.push({
        kind: "different_business",
        severity: reliableName ? "high" : "medium",
        message: `These links may belong to different businesses: the website is "${strongName.value}" but the Google link names "${disagreeing[0]?.value}".`,
        sources: ["website", ...disagreeing.map((d) => d.type)],
      });
    } else if (agreeing.length > 0) {
      status = "verified";
      note = "The website and the Google link name the same business.";
      for (const t of agreeing) evidence.push({ sourceType: t, method: "url_pattern", pageUrl: null, detail: "Place name in the Google link" });
    }
    name = { value: strongName.value, status, evidence, note, alternatives: websiteNames.map((n) => n.value).filter((v) => v !== strongName.value).slice(0, 3) };
  } else if (placeHints[0]?.placeName) {
    name = {
      value: placeHints[0].placeName,
      status: "unverified",
      evidence: [{ sourceType: placeHints[0].type, method: "url_pattern", pageUrl: null, detail: "Place name in the Google link" }],
      note: "Taken from the text of the Google link only — Google's listing itself was not read.",
    };
  } else {
    name = unavailable("No business name could be confirmed from the submitted links.");
  }

  // ---------- Ownership links (does the website point to the submitted profiles?) ----------
  const siteLinks = (facts?.socialLinks ?? []).map((f) => f.value);
  for (const s of socials) {
    const network = s.type === "facebook" ? "facebook" : "linkedin";
    if (!facts) {
      ownership.push({ type: s.type, ownership: "not_checked", detail: "No website was read, so we couldn't check that the website links to this page." });
      continue;
    }
    const linksOfNetwork = siteLinks.filter((l) => l.network === network);
    if (linksOfNetwork.some((l) => idMatches(l, s.identifier))) {
      ownership.push({ type: s.type, ownership: "confirmed", detail: "The official website links to this exact page." });
    } else if (linksOfNetwork.length > 0) {
      ownership.push({ type: s.type, ownership: "mismatch", detail: `The website links to a different ${network === "facebook" ? "Facebook" : "LinkedIn"} page (${linksOfNetwork[0]?.url}).` });
      conflicts.push({
        kind: "profile_link_mismatch",
        severity: "medium",
        message: `The website links to ${linksOfNetwork[0]?.url}, not the ${network === "facebook" ? "Facebook" : "LinkedIn"} page you submitted.`,
        sources: ["website", s.type],
      });
    } else {
      ownership.push({ type: s.type, ownership: "not_found", detail: `The website doesn't link to any ${network === "facebook" ? "Facebook" : "LinkedIn"} page, so ownership couldn't be confirmed.` });
    }
    if (strongName && s.identifier && !/^\d+$/.test(s.identifier) && !slugMatchesName(s.identifier, strongName.value)) {
      const confirmed = ownership[ownership.length - 1]?.ownership === "confirmed";
      if (!confirmed) {
        conflicts.push({
          kind: "name_mismatch",
          severity: "low",
          message: `The ${network === "facebook" ? "Facebook" : "LinkedIn"} page name "${s.identifier}" doesn't obviously match "${strongName.value}".`,
          sources: ["website", s.type],
        });
      }
    }
  }
  for (const s of mapsLike) {
    if (!facts) {
      ownership.push({ type: s.type, ownership: "not_checked", detail: "No website was read to cross-check this Google link." });
    } else if (siteLinks.some((l) => l.network === "google_maps")) {
      ownership.push({ type: s.type, ownership: "not_found", detail: "The website links to or embeds a Google map, but the place can't be matched without Google's own data." });
    } else {
      ownership.push({ type: s.type, ownership: "not_found", detail: "The website doesn't link to a Google listing." });
    }
  }

  // ---------- Website ----------
  let websiteField: VerifiedField;
  if (website && website.retrievalStatus === "retrieved") {
    const origin = new URL(website.finalUrl ?? website.normalizedUrl).origin;
    const linkedBack = ownership.some((o) => o.ownership === "confirmed");
    websiteField = {
      value: origin,
      status: linkedBack ? "verified" : "partial",
      evidence: [{ sourceType: "website", method: "public_website_fetch", pageUrl: website.finalUrl, detail: `HTTP ${website.httpStatus ?? 200}` }],
      note: linkedBack ? "The website is live and links to another submitted official profile." : "The website is live; no second source confirms it belongs to this business yet.",
    };
  } else if (website) {
    websiteField = unavailable(`The website could not be opened: ${website.errorMessage ?? "no response"}`);
  } else {
    websiteField = unavailable("No website link was submitted.");
  }

  // ---------- Phone ----------
  let phone = singleWebsiteField(facts, facts?.phones, "phone number");
  if (facts && facts.phones.length > 1) {
    const structured = facts.phones.filter((p) => p.method === "structured_data");
    const distinctStructured = new Set(structured.map((p) => phoneDigits(p.value)));
    if (distinctStructured.size > 1) {
      phone = { ...phone, status: "conflicting", note: "The website's structured data lists more than one main phone number.", alternatives: [...distinctStructured] };
      conflicts.push({ kind: "phone_mismatch", severity: "medium", message: "The website's structured data lists different phone numbers for the business.", sources: ["website"] });
    }
  }

  // ---------- Address + city ----------
  const address = facts
    ? (() => {
        const list = facts.addresses as Fact<PostalAddress>[];
        const best = list.find((a) => a.method === "structured_data") ?? list[0];
        if (!best) return unavailable<string>("No address was found on the website.");
        const field: VerifiedField = {
          value: best.value.formatted,
          status: best.method === "structured_data" ? "partial" : "unverified",
          evidence: list.slice(0, 3).map(evidenceOf),
          note: best.method === "structured_data" ? "Found in the website's structured data only — not yet confirmed by a second source." : "Seen on the page but not in a machine-readable format.",
        };
        return field;
      })()
    : unavailable<string>("No website was read, so the address could not be checked.");
  const structuredLocality = (facts?.addresses as Fact<PostalAddress>[] | undefined)?.find((a) => a.value.locality);
  const city: VerifiedField = structuredLocality
    ? { value: structuredLocality.value.locality, status: "partial", evidence: [evidenceOf(structuredLocality)], note: "Town taken from the website's structured address." }
    : unavailable("No town or city could be read from a structured address.");

  const fields: VerifiedFields = {
    name,
    website: websiteField,
    category: singleWebsiteField(facts, facts?.categories, "business category"),
    description: singleWebsiteField(facts, facts?.descriptions, "description"),
    address,
    city,
    serviceAreas: listWebsiteField(facts, facts?.areasServed, "service areas"),
    phone,
    email: singleWebsiteField(facts, facts?.emails, "email address"),
    hours: listWebsiteField(facts, facts?.hours, "opening hours"),
    services: listWebsiteField(facts, facts?.services, "services"),
    socialProfiles: (() => {
      const submitted = socials.map((s) => s.normalizedUrl);
      const found = siteLinks.filter((l) => l.network !== "google_maps").map((l) => l.url);
      const all = [...new Set([...submitted, ...found])];
      if (all.length === 0) return unavailable<string[]>("No social profiles were submitted or found on the website.");
      const confirmedCount = ownership.filter((o) => o.ownership === "confirmed").length;
      return {
        value: all.slice(0, 10),
        status: confirmedCount > 0 ? "verified" : found.length > 0 ? "partial" : "unverified",
        evidence: [
          ...(found.length ? [{ sourceType: "website" as const, method: "page_link", pageUrl: website?.finalUrl ?? null, detail: `${found.length} profile link(s) on the website` }] : []),
          ...socials.map((s) => ({ sourceType: s.type, method: "url_pattern", pageUrl: null, detail: "Submitted link (format checked)" })),
        ],
        note: confirmedCount > 0 ? "At least one submitted profile is linked from the official website." : found.length > 0 ? "Profiles linked from the website." : "Submitted links only — not confirmed by the website.",
      };
    })(),
  };

  // ---------- Limitations (honest about what wasn't read) ----------
  for (const s of sources) {
    if (s.type === "facebook") limitations.push("Facebook page content was not read: Facebook only shares page details with the page owner's permission. Only the link format and the website's link to it were checked.");
    if (s.type === "linkedin") limitations.push("LinkedIn page content was not read: LinkedIn only shares company page details through approved partner access. Only the link format and the website's link to it were checked.");
    if (s.type === "google_maps" || s.type === "google_business_profile") limitations.push("Google listing details (reviews, hours, photos, categories) were not read: that needs Google Places API access. Only the link and the place name inside it were checked.");
  }

  // ---------- Confidence (evidence, not link count) ----------
  const high = conflicts.filter((c) => c.severity === "high");
  const medium = conflicts.filter((c) => c.severity === "medium");
  const retrieved = sources.filter((s) => s.retrievalStatus === "retrieved");
  const corroborations = ownership.filter((o) => o.ownership === "confirmed").length + (name.status === "verified" ? 1 : 0);
  let points = 0;
  if (retrieved.length > 0) {
    points += 1;
    reasons.push("The official website was read directly.");
  } else {
    reasons.push("No source could be read directly — only link formats were checked.");
  }
  if (strongName) {
    points += 1;
    reasons.push("The business name was found on the website.");
  }
  if (facts && (fields.phone.value || fields.address.value)) points += 1;
  points += Math.min(2, corroborations);
  if (corroborations > 0) reasons.push(`${corroborations} independent cross-check${corroborations === 1 ? "" : "s"} matched.`);
  if (high.length) reasons.push("Links appear to belong to different businesses.");
  if (medium.length) reasons.push("Some details conflict between sources.");

  let confidence: Confidence;
  if (high.length > 0 || retrieved.length === 0) confidence = "low";
  else if (points >= 4 && corroborations >= 1 && medium.length === 0) confidence = "high";
  else if (points >= 2) confidence = "medium";
  else confidence = "low";

  // ---------- Score ----------
  let score = 0;
  for (const [key, weight] of Object.entries(FIELD_WEIGHTS) as Array<[keyof VerifiedFields, number]>) {
    score += weight * STATUS_CREDIT[fields[key].status];
  }
  score = Math.round(score);
  const withEvidence = (Object.keys(FIELD_WEIGHTS) as Array<keyof VerifiedFields>).filter((k) => fields[k].status === "verified" || fields[k].status === "partial").length;
  const isProvisional = confidence === "low" || withEvidence < 3;

  let websiteDomain: string | null = null;
  if (website) {
    try {
      websiteDomain = new URL(website.finalUrl ?? website.normalizedUrl).hostname.replace(/^www\./, "");
    } catch {
      websiteDomain = null;
    }
  }

  return {
    engineVersion: VERIFICATION_ENGINE_VERSION,
    fields,
    conflicts,
    ownership,
    confidence,
    confidenceReasons: reasons,
    score,
    isProvisional,
    limitations: [...new Set(limitations)],
    businessName: name.value,
    websiteDomain,
  };
}

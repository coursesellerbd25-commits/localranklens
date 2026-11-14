/**
 * Business verification rules: link validation, source-type detection,
 * evidence extraction, conflict detection, confidence and scoring.
 */
import { describe, expect, it } from "vitest";

import { classifySourceUrl, validateSubmittedLinks } from "./sources";
import { emptyFacts, extractWebsiteFacts } from "./extract";
import { assessVerification, namesMatch, type SourceResult } from "./assess";

const SITE_HTML = `<!doctype html><html><head>
<title>Home | Joe's Plumbing Leeds</title>
<meta property="og:site_name" content="Joe's Plumbing">
<meta name="description" content="Emergency plumbers in Leeds.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Joe's Plumbing Ltd",
"telephone":"+44 113 496 0000","email":"hello@joesplumbing.co.uk",
"address":{"@type":"PostalAddress","streetAddress":"1 Kirkgate","addressLocality":"Leeds","postalCode":"LS1 6BY","addressCountry":"GB"},
"openingHours":["Mo-Fr 08:00-18:00"],"sameAs":["https://www.facebook.com/joesplumbingleeds"]}</script>
</head><body><a href="tel:+441134960000">Call</a><a href="https://www.linkedin.com/company/joes-plumbing">LinkedIn</a></body></html>`;

function website(html = SITE_HTML): SourceResult {
  return {
    type: "website",
    submittedUrl: "https://joesplumbing.co.uk",
    normalizedUrl: "https://joesplumbing.co.uk/",
    finalUrl: "https://joesplumbing.co.uk/",
    retrievalStatus: "retrieved",
    retrievalMethod: "public_website_fetch",
    httpStatus: 200,
    errorMessage: null,
    identifier: "joesplumbing.co.uk",
    placeName: null,
    facts: extractWebsiteFacts(html, "https://joesplumbing.co.uk/", emptyFacts()),
    pagesRead: ["https://joesplumbing.co.uk/"],
  };
}

function linkOnly(type: SourceResult["type"], identifier: string | null, placeName: string | null = null): SourceResult {
  return {
    type,
    submittedUrl: `https://example.org/${identifier ?? "x"}`,
    normalizedUrl: `https://example.org/${identifier ?? "x"}`,
    finalUrl: null,
    retrievalStatus: "url_checked",
    retrievalMethod: "url_pattern",
    httpStatus: null,
    errorMessage: null,
    identifier,
    placeName,
    facts: null,
    pagesRead: [],
  };
}

describe("source link validation and type detection", () => {
  it("detects all five accepted source types", () => {
    const cases: Array<[string, string]> = [
      ["joesplumbing.co.uk", "website"],
      ["https://maps.app.goo.gl/abc123", "google_maps"],
      ["https://www.google.com/maps/place/Joe's+Plumbing/@53.79,-1.54,17z", "google_maps"],
      ["https://g.page/joesplumbing", "google_business_profile"],
      ["https://www.facebook.com/joesplumbingleeds", "facebook"],
      ["https://www.linkedin.com/company/joes-plumbing/", "linkedin"],
    ];
    for (const [url, type] of cases) {
      const result = classifySourceUrl(url);
      expect(result.ok, url).toBe(true);
      if (result.ok) expect(result.type, url).toBe(type);
    }
  });

  it("rejects malformed links and non-official pages", () => {
    expect(classifySourceUrl("not a url").ok).toBe(false);
    expect(classifySourceUrl("http://localhost/admin").ok).toBe(false);
    expect(classifySourceUrl("https://www.linkedin.com/in/joe-bloggs").ok).toBe(false);
    expect(classifySourceUrl("https://www.facebook.com/sharer/sharer.php?u=x").ok).toBe(false);
    expect(classifySourceUrl("https://www.yelp.com/biz/joes-plumbing").ok).toBe(false);
    expect(classifySourceUrl("https://www.google.com/maps").ok).toBe(false);
  });

  it("requires at least one link and allows one link per type", () => {
    expect(validateSubmittedLinks(["", "  "]).errors[0]?.message).toMatch(/at least one/i);
    const dup = validateSubmittedLinks(["https://a-shop.com", "https://b-shop.com"]);
    expect(dup.sources).toHaveLength(1);
    expect(dup.errors[0]?.index).toBe(1);
    expect(validateSubmittedLinks(["https://a-shop.com"]).errors).toHaveLength(0);
  });
});

describe("website evidence extraction", () => {
  it("reads name, phone, address, hours and profile links with their evidence", () => {
    const facts = extractWebsiteFacts(SITE_HTML, "https://joesplumbing.co.uk/");
    expect(facts.names[0]).toMatchObject({ value: "Joe's Plumbing Ltd", method: "structured_data" });
    expect(facts.phones).toHaveLength(1); // JSON-LD and tel: link are the same number
    expect(facts.addresses[0]?.value.locality).toBe("Leeds");
    expect(facts.hours[0]?.value).toBe("Mo-Fr 08:00-18:00");
    expect(facts.categories[0]?.value).toBe("Plumber");
    expect(facts.socialLinks.map((l) => l.value.identifier)).toEqual(["joesplumbingleeds", "joes-plumbing"]);
  });

  it("invents nothing for a page without business details", () => {
    const facts = extractWebsiteFacts("<html><head><title>Home</title></head><body>Hello</body></html>", "https://x-shop.com/");
    expect(facts.names).toHaveLength(0);
    expect(facts.phones).toHaveLength(0);
    expect(facts.addresses).toHaveLength(0);
  });
});

describe("verification assessment", () => {
  it("a website alone gives partially verified details and medium confidence", () => {
    const a = assessVerification([website()]);
    expect(a.fields.name.status).toBe("partial");
    expect(a.fields.phone.status).toBe("partial");
    expect(a.confidence).toBe("medium");
    expect(a.score).toBeGreaterThan(0);
    expect(a.score).toBeLessThan(100);
  });

  it("five links that were only format-checked never give high confidence", () => {
    const a = assessVerification([
      linkOnly("google_maps", null, "Joe's Plumbing"),
      linkOnly("google_business_profile", "joesplumbing"),
      linkOnly("facebook", "joesplumbingleeds"),
      linkOnly("linkedin", "joes-plumbing"),
      { ...linkOnly("website", "joesplumbing.co.uk"), retrievalStatus: "unreachable", errorMessage: "No response" },
    ]);
    expect(a.confidence).toBe("low");
    expect(a.isProvisional).toBe(true);
    expect(a.fields.name.status).toBe("unverified");
    expect(a.score).toBe(0);
  });

  it("profiles linked from the website plus a matching Maps name give high confidence", () => {
    const a = assessVerification([
      website(),
      linkOnly("facebook", "joesplumbingleeds"),
      linkOnly("google_maps", null, "Joe's Plumbing"),
    ]);
    expect(a.ownership.find((o) => o.type === "facebook")?.ownership).toBe("confirmed");
    expect(a.fields.name.status).toBe("verified");
    expect(a.confidence).toBe("high");
  });

  it("flags links that belong to different businesses and drops confidence to low", () => {
    const a = assessVerification([website(), linkOnly("google_maps", null, "Pizza Palace Manchester")]);
    expect(a.conflicts.some((c) => c.kind === "different_business" && c.severity === "high")).toBe(true);
    expect(a.fields.name.status).toBe("conflicting");
    expect(a.confidence).toBe("low");
  });

  it("flags a Facebook page that the website does not link to", () => {
    const a = assessVerification([website(), linkOnly("facebook", "someotherbusiness")]);
    expect(a.ownership.find((o) => o.type === "facebook")?.ownership).toBe("mismatch");
    expect(a.conflicts.some((c) => c.kind === "profile_link_mismatch")).toBe(true);
    expect(a.confidence).not.toBe("high");
  });

  it("flags conflicting phone numbers in the website's own data", () => {
    const html = SITE_HTML.replace('"telephone":"+44 113 496 0000"', '"telephone":["+44 113 496 0000","+44 161 496 0999"]');
    const a = assessVerification([website(html)]);
    expect(a.fields.phone.status).toBe("conflicting");
  });

  it("matches business names despite legal suffixes and punctuation", () => {
    expect(namesMatch("Joe's Plumbing Ltd", "Joes Plumbing")).toBe(true);
    expect(namesMatch("Joe's Plumbing", "Pizza Palace")).toBe(false);
  });
});

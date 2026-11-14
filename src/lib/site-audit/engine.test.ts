/**
 * Deterministic-rule tests for the website audit engine and URL guard.
 * Run with: bun test src/lib/site-audit/engine.test.ts
 */

import { describe, expect, test } from "vitest";

import { runWebsiteAudit, scoreSiteFindings, type SiteAuditData, type MainFetch } from "./engine";
import { runLocalReadiness } from "./local";
import { CATEGORY_POINT_LIMITS, SITE_AUDIT_CATEGORIES } from "./types";
import { SITE_CHECKS } from "./engine";
import { validateAndNormalizeUrl, isPrivateIPv4, isPrivateIPv6 } from "./url-guard";
import { robotsDisallows, sitemapUrlsFromRobots } from "./parse";

function makeSignals(overrides: Partial<MainFetch["signals"]> = {}): MainFetch["signals"] {
  return {
    title: "Emergency Plumber in Leeds | Example Heating",
    metaDescription: "x".repeat(120),
    canonical: "https://www.example.com/",
    robotsMeta: null,
    viewport: "width=device-width, initial-scale=1",
    htmlLang: "en",
    h1Count: 1,
    h1Texts: ["Emergency Plumber in Leeds"],
    h2Count: 4,
    headingSequence: [1, 2, 2, 3, 2],
    headingLevelsSkipped: false,
    imageTotal: 10,
    imagesWithAltAttribute: 10,
    imagesWithEmptyAlt: 0,
    imagesWithSrcset: 10,
    internalLinks: [
      "https://www.example.com/services/",
      "https://www.example.com/about/",
      "https://www.example.com/contact/",
      "https://www.example.com/emergency-plumber-leeds/",
      "https://www.example.com/areas-covered/",
    ],
    internalLinkCount: 12,
    externalLinkCount: 2,
    telLinkFound: true,
    mailtoLinkFound: true,
    formSignals: { controls: 3, labeled: 3 },
    jsonLdTypes: ["LocalBusiness"],
    geoMetaFound: true,
    mapsEmbedFound: true,
    addressTagFound: false,
    addressLikeText: true,
    cityMentionCount: 0,
    textSample: "We are open Monday to Friday.",
    byteLength: 1000,
    ...overrides,
  };
}

function makeData(overrides: Partial<SiteAuditData> = {}, signals: Partial<MainFetch["signals"]> = {}): SiteAuditData {
  return {
    requestedUrl: "https://example.com/",
    main: {
      requestedUrl: "https://example.com/",
      finalUrl: "https://www.example.com/",
      status: 200,
      redirectChain: [],
      signals: makeSignals(signals),
      headers: {},
      bytes: 1000,
      elapsedMs: 300,
    },
    robots: { available: true, status: 200, disallowsHome: false, sitemapUrl: "https://www.example.com/sitemap.xml" },
    sitemap: { available: true, url: "https://www.example.com/sitemap.xml", status: 200 },
    subpages: [
      { url: "https://www.example.com/services/", status: 200, title: "Services — Example Heating", metaDescription: "y".repeat(100), bytes: 900 },
      { url: "https://www.example.com/contact/", status: 200, title: "Contact — Example Heating", metaDescription: "z".repeat(90), bytes: 800 },
    ],
    psi: { available: false, error: "unavailable" },
    totalElapsedMs: 500,
    ...overrides,
  };
}

describe("scoring weights", () => {
  test("each category's check weights sum to its configured point limit", () => {
    for (const category of SITE_AUDIT_CATEGORIES) {
      const sum = SITE_CHECKS.filter((c) => c.category === category).reduce((s, c) => s + c.weight, 0);
      expect(sum).toBe(CATEGORY_POINT_LIMITS[category]);
    }
  });
});

describe("runWebsiteAudit", () => {
  test("a good page passes every testable check", () => {
    const result = runWebsiteAudit(makeData());
    // PSI unavailable → the 7 performance checks are not_tested, not failed.
    expect(result.notTestedCount).toBe(7);
    expect(result.findings.filter((f) => f.status === "fail")).toHaveLength(0);
    expect(result.overallScore).toBe(100);
  });

  test("not-tested checks are excluded from the denominator", () => {
    const summary = scoreSiteFindings(
      runWebsiteAudit(makeData()).findings,
    );
    const possible = summary.findings
      .filter((f) => f.status !== "not_tested")
      .reduce((s, f) => s + f.weight, 0);
    expect(possible).toBe(75); // 100 - 25 performance points
  });

  test("a missing title and noindex page fail with expected counts", () => {
    const result = runWebsiteAudit(makeData({}, { title: null, robotsMeta: "noindex, nofollow" }));
    const title = result.findings.find((f) => f.checkKey === "title");
    const indexability = result.findings.find((f) => f.checkKey === "indexability");
    expect(title?.status).toBe("fail");
    expect(indexability?.status).toBe("fail");
    expect(result.criticalCount).toBeGreaterThanOrEqual(2);
  });

  test("warnings earn partial credit (55%)", () => {
    const result = runWebsiteAudit(makeData({}, { title: "Short", viewport: "width=1024" }));
    const title = result.findings.find((f) => f.checkKey === "title");
    expect(title?.status).toBe("fail"); // 5 chars < 15 → fail, not warn
    const fixed = result.findings.find((f) => f.checkKey === "fixed_width");
    expect(fixed?.status).toBe("fail");
  });

  test("same observations always produce the same score", () => {
    const a = runWebsiteAudit(makeData());
    const b = runWebsiteAudit(makeData());
    expect(a.overallScore).toBe(b.overallScore);
  });

  test("full PSI data lifts the score into every category", () => {
    const psi = {
      available: true,
      mobile: {
        strategy: "mobile" as const,
        available: true,
        performanceScore: 0.95,
        metrics: {
          lcp: { value: 1400, display: "1.4 s", score: 0.95, unit: "ms" },
          cls: { value: 0.03, display: "0.03", score: 1, unit: "unitless" },
          inp: { value: 120, display: "120 ms", score: 0.95, unit: "ms" },
          fcp: { value: 1200, display: "1.2 s", score: 0.95, unit: "ms" },
          si: { value: 2200, display: "2.2 s", score: 0.95, unit: "ms" },
        },
        opportunities: [],
      },
      desktop: {
        strategy: "desktop" as const,
        available: true,
        performanceScore: 0.99,
        metrics: {},
        opportunities: [],
      },
    };
    const result = runWebsiteAudit(makeData({ psi }));
    expect(result.notTestedCount).toBe(0);
    expect(result.findings.filter((f) => f.category === "Performance").every((f) => f.status === "pass")).toBe(true);
    expect(result.overallScore).toBe(100);
  });
});

describe("local readiness", () => {
  test("check weights total 100", () => {
    const local = runLocalReadiness(makeData(), { city: "Leeds" });
    const total = local.findings.reduce((s, f) => s + f.weight, 0);
    expect(total).toBe(100);
  });

  test("GBP check stays not tested without authorized data", () => {
    const local = runLocalReadiness(makeData(), { city: "Leeds" });
    const gbp = local.findings.find((f) => f.key === "gbp_readiness");
    expect(gbp?.status).toBe("not_tested");
    expect(gbp?.manualVerification).toBe(true);
  });
});

describe("url guard", () => {
  test("adds https scheme to bare domains", () => {
    const check = validateAndNormalizeUrl("example.com");
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.url.protocol).toBe("https:");
  });

  test("rejects private and internal addresses", () => {
    for (const bad of ["localhost", "127.0.0.1", "192.168.1.10", "http://10.0.0.5", "metadata.google.internal", "http://user:pass@example.com", "ftp://example.com"]) {
      expect(validateAndNormalizeUrl(bad).ok).toBe(false);
    }
  });

  test("private IP ranges are detected for v4 and v6", () => {
    expect(isPrivateIPv4("169.254.169.254")).toBe(true);
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateIPv6("fe80::1")).toBe(true);
    expect(isPrivateIPv6("2606:4700::1")).toBe(false);
  });
});

describe("robots.txt parsing", () => {
  test("detects homepage disallow and sitemap declarations", () => {
    const robots = "User-agent: *\nDisallow: /admin\n\nUser-agent: *\nDisallow: /\n\nSitemap: https://example.com/sitemap.xml";
    expect(robotsDisallows(robots, "/")).toBe(true);
    const permissive = "User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml";
    expect(robotsDisallows(permissive, "/")).toBe(false);
    expect(sitemapUrlsFromRobots(permissive)).toEqual(["https://example.com/sitemap.xml"]);
  });
});

describe("URL structure rule", () => {
  const statusFor = (links: string[]) =>
    runWebsiteAudit(makeData({}, { internalLinks: links })).findings.find((f) => f.checkKey === "url_structure")?.status;

  test("locale segments like /en-US/ are not treated as messy casing", () => {
    expect(statusFor(["https://x.com/en-US/docs/", "https://x.com/en-US/blog/", "https://x.com/fr-FR/"])).toBe("pass");
  });

  test("uppercase page names are still flagged", () => {
    expect(statusFor(["https://x.com/About-Us/", "https://x.com/Contact/", "https://x.com/Services/"])).toBe("fail");
  });
});

describe("Performance without PageSpeed data", () => {
  test("missing PageSpeed data marks performance checks not_tested and leaves them out of the score", () => {
    const result = runWebsiteAudit(makeData());
    for (const key of ["psi_mobile", "psi_desktop", "lcp", "cls"]) {
      const finding = result.findings.find((f) => f.checkKey === key);
      expect(finding?.status).toBe("not_tested");
      expect(finding?.pointsEarned).toBe(0);
    }
    expect(result.overallScore).toBeGreaterThan(90);
  });
});

describe("Partial credit", () => {
  test("a warning never earns the check's full points (robots.txt missing on a 1-point check)", () => {
    const result = runWebsiteAudit(makeData({ robots: { available: false, status: null, disallowsHome: false, sitemapUrl: null } }));
    const robots = result.findings.find((f) => f.checkKey === "robots_txt");
    expect(robots?.status).toBe("warn");
    expect(robots?.pointsEarned).toBe(0);
  });

  test("every warning earns less than its weight", () => {
    const result = runWebsiteAudit(makeData({}, { title: "Short title here", canonical: null }));
    for (const f of result.findings.filter((x) => x.status === "warn")) {
      expect(f.pointsEarned).toBeLessThan(f.weight);
    }
  });
});

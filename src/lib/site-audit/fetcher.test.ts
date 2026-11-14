/**
 * SSRF guard tests for the server-side fetcher: redirect targets and DNS
 * answers are re-validated on every hop. Network is mocked.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

import { guardedFetch } from "./fetcher.server";

const PUBLIC_IP = "93.184.216.34";

function mockNetwork(dns: Record<string, string>, pages: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "dns.google") {
      const name = url.searchParams.get("name") ?? "";
      const type = url.searchParams.get("type");
      const ip = dns[name];
      if (!ip) return Response.json({ Status: 3 });
      return Response.json({ Status: 0, Answer: type === "A" ? [{ type: 1, data: ip }] : [] });
    }
    const page = pages[url.href];
    if (!page) throw new Error(`unexpected fetch ${url.href}`);
    return page();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const redirectTo = (location: string) => () => new Response(null, { status: 302, headers: { location } });

afterEach(() => vi.unstubAllGlobals());

describe("guardedFetch redirect revalidation", () => {
  test("blocks a redirect to localhost", async () => {
    mockNetwork({ "site.org": PUBLIC_IP }, { "https://site.org/": redirectTo("http://127.0.0.1/") });
    const result = await guardedFetch("https://site.org/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("blocked_host");
  });

  test("blocks a redirect to the cloud metadata endpoint", async () => {
    mockNetwork({ "site.org": PUBLIC_IP }, { "https://site.org/": redirectTo("http://169.254.169.254/latest/meta-data") });
    const result = await guardedFetch("https://site.org/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("blocked_host");
  });

  test("blocks a redirect to a hostname that resolves to a private address", async () => {
    const fetchMock = mockNetwork(
      { "site.org": PUBLIC_IP, "internal.site.org": "10.0.0.5" },
      { "https://site.org/": redirectTo("https://internal.site.org/admin") },
    );
    const result = await guardedFetch("https://site.org/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("blocked_host");
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("https://internal.site.org"))).toBe(false);
  });

  test("blocks a redirect to a non-http scheme", async () => {
    mockNetwork({ "site.org": PUBLIC_IP }, { "https://site.org/": redirectTo("file:///etc/passwd") });
    const result = await guardedFetch("https://site.org/");
    expect(result.ok).toBe(false);
  });

  test("follows a safe redirect and reports the final URL", async () => {
    mockNetwork(
      { "site.org": PUBLIC_IP, "www.site.org": PUBLIC_IP },
      {
        "https://site.org/": redirectTo("https://www.site.org/"),
        "https://www.site.org/": () =>
          new Response("<html><title>Hi</title></html>", { status: 200, headers: { "content-type": "text/html" } }),
      },
    );
    const result = await guardedFetch("https://site.org/");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("https://www.site.org/");
      expect(result.redirectChain).toEqual(["https://site.org/"]);
    }
  });

  test("distinguishes a missing domain from a 404 page", async () => {
    mockNetwork({ "site.org": PUBLIC_IP }, { "https://site.org/missing": () => new Response("no", { status: 404 }) });
    const missing = await guardedFetch("https://nope-not-real.org/");
    const notFound = await guardedFetch("https://site.org/missing");
    expect(!missing.ok && missing.kind).toBe("dns_not_found");
    expect(!notFound.ok && notFound.kind).toBe("http_404");
  });
});

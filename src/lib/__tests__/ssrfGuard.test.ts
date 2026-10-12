import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isBlockedHost, fetchWithSsrfGuard } from "../ssrfGuard";

describe("isBlockedHost", () => {
  it("blocks loopback and private IPv4 ranges", () => {
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("127.0.0.42")).toBe(true);
    expect(isBlockedHost("10.0.0.1")).toBe(true);
    expect(isBlockedHost("192.168.1.1")).toBe(true);
    expect(isBlockedHost("172.16.0.1")).toBe(true);
    expect(isBlockedHost("169.254.1.1")).toBe(true);
    expect(isBlockedHost("100.64.0.1")).toBe(true);
    expect(isBlockedHost("0.0.0.0")).toBe(true);
  });

  it("blocks bracketed IPv6 loopback and unique local", () => {
    expect(isBlockedHost("[::1]")).toBe(true);
    expect(isBlockedHost("::1")).toBe(true);
    expect(isBlockedHost("fc00::1")).toBe(true);
    expect(isBlockedHost("fe80::1")).toBe(true);
  });

  it("allows public hosts", () => {
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
  });
});

describe("fetchWithSsrfGuard", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects redirect to a blocked host", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/secret" },
      }),
    );

    await expect(fetchWithSsrfGuard("https://example.com/data.csv")).rejects.toThrow(/not allowed/i);
  });

  it("follows a safe redirect chain", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://cdn.example.com/file.csv" },
        }),
      )
      .mockResolvedValueOnce(new Response("a,b\n1,2", { status: 200 }));

    const res = await fetchWithSsrfGuard("https://example.com/data.csv");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

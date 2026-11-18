import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, errorMessage } from "../src/lib/api";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("calls same-origin /api and sends actor plus timeout signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.health()).resolves.toEqual({ status: "ok" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/health");
    expect((init.headers as Headers).get("X-Actor")).toBe("analyst");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("builds query strings and omits empty filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.listDocuments({ page: 2, page_size: 10, q: "", tlp: "AMBER" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/documents?page=2&page_size=10&tlp=AMBER",
    );
  });

  it("normalises error envelopes into ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { detail: "Document not found", code: "not_found", request_id: "abc123" },
          { status: 404 },
        ),
      ),
    );

    await expect(api.getDocument("missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "not_found",
      requestId: "abc123",
      message: "Document not found",
    });
  });

  it("formats error messages with a shortened request id", () => {
    const error = new ApiError("Boom", {
      status: 500,
      code: "internal_error",
      requestId: "1234567890abcdef",
    });
    expect(errorMessage(error)).toBe("Boom (request 1234567890ab)");
  });

  it("surfaces network failures as status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(api.meta()).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
      code: "network_error",
    });
  });
});

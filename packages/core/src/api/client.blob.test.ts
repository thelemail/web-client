import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blobPut = vi.fn();

vi.mock("$env/static/public", () => ({
  PUBLIC_API_BASE_URL: "https://api.test/",
  PUBLIC_SUBMISSION_BASE_URL: "https://submit.test",
}));
vi.mock("$platform", () => ({
  platform: { blobPut: (...a: unknown[]) => blobPut(...a) },
}));
vi.mock("$core/realtime/device", () => ({ deviceId: () => "device-1" }));

import {
  apiBlobFetch,
  apiBlobPut,
  apiUrl,
  registerAuthRouter,
  registerTransport,
} from "./client";
import { ApiCallError } from "./types";

const ACCOUNT = "acct-1";
let token = "tok-1";
const transport = vi.fn();
const onUnauthorized = vi.fn(async () => {
  token = "tok-2";
  return true;
});

beforeEach(() => {
  token = "tok-1";
  transport.mockReset();
  blobPut.mockReset();
  onUnauthorized.mockClear();
  registerTransport(transport);
  registerAuthRouter({
    currentAccountId: () => ACCOUNT,
    getAccessToken: () => token,
    ensureFreshToken: async () => {},
    isSessionLost: () => false,
    onUnauthorized,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("apiUrl", () => {
  it("joins a relative path to the api origin", () => {
    expect(apiUrl("/v1/attachments/a1")).toBe(
      "https://api.test/v1/attachments/a1",
    );
  });

  it("refuses anything that could leave the api origin", () => {
    expect(() => apiUrl("https://fsn1.your-objectstorage.com/b/k")).toThrow();
    expect(() => apiUrl("//evil.test/x")).toThrow();
  });
});

describe("apiBlobFetch", () => {
  it("sends the bearer token, account and device and returns the raw response", async () => {
    transport.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );

    const resp = await apiBlobFetch("/v1/messages/m1/body", {
      accountId: "acct-2",
    });

    expect(new Uint8Array(await resp.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    const [url, init, kind] = transport.mock.calls[0];
    expect(url).toBe("https://api.test/v1/messages/m1/body");
    expect(kind).toBe("api");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok-1",
      "X-Account-Id": "acct-2",
      "X-Device-Id": "device-1",
    });
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    transport
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await apiBlobFetch("/v1/attachments/a1");

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer tok-2",
    );
  });

  it("raises the api error for anything else", async () => {
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "not_found", message: "not found" } }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const err = await apiBlobFetch("/v1/attachments/a1").catch((e) => e);

    expect(err).toBeInstanceOf(ApiCallError);
    expect((err as ApiCallError).status).toBe(404);
  });
});

describe("apiBlobPut", () => {
  const body = new Blob([new Uint8Array([9])]);

  it("uploads to the api with auth and no object-store headers", async () => {
    blobPut.mockResolvedValue(new Response(null, { status: 204 }));
    const onProgress = vi.fn();

    await apiBlobPut("/v1/me/avatar/uploads/u1", body, { onProgress });

    const [url, sent, headers, opts] = blobPut.mock.calls[0];
    expect(url).toBe("https://api.test/v1/me/avatar/uploads/u1");
    expect(sent).toBe(body);
    expect(headers).toEqual({
      "Content-Type": "application/octet-stream",
      Authorization: "Bearer tok-1",
      "X-Account-Id": ACCOUNT,
      "X-Device-Id": "device-1",
    });
    expect(opts.onProgress).toBe(onProgress);
  });

  it("waits and retries while the api is at its upload limit", async () => {
    vi.useFakeTimers();
    blobPut
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 503, headers: { "retry-after": "3" } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const done = apiBlobPut("/v1/attachments/uploads?objectKey=k", body);
    await vi.advanceTimersByTimeAsync(1000);
    expect(blobPut).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2999);
    expect(blobPut).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(blobPut).toHaveBeenCalledTimes(3);
  });

  it("gives up after repeated refusals", async () => {
    vi.useFakeTimers();
    blobPut.mockResolvedValue(new Response(null, { status: 429 }));

    const done = apiBlobPut("/v1/attachments/uploads?objectKey=k", body).catch(
      (e) => e,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await done;

    expect(err).toBeInstanceOf(ApiCallError);
    expect((err as ApiCallError).status).toBe(429);
    expect(blobPut).toHaveBeenCalledTimes(5);
  });

  it("stops waiting when the upload is cancelled", async () => {
    vi.useFakeTimers();
    blobPut.mockResolvedValue(new Response(null, { status: 429 }));
    const ctl = new AbortController();

    const done = apiBlobPut("/v1/attachments/uploads?objectKey=k", body, {
      signal: ctl.signal,
    }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    ctl.abort();
    const err = await done;

    expect((err as DOMException).name).toBe("AbortError");
    expect(blobPut).toHaveBeenCalledTimes(1);
  });

  it("refreshes once on 401 and does not retry a rejected body", async () => {
    blobPut
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }));

    const err = await apiBlobPut(
      "/v1/drafts/d1/attachments/uploads/u1",
      body,
    ).catch((e) => e);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(blobPut.mock.calls[1][2].Authorization).toBe("Bearer tok-2");
    expect((err as ApiCallError).status).toBe(400);
    expect(blobPut).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("$lib/api/messages", () => ({ getMessage: vi.fn() }));
vi.mock("./decrypt", () => ({ decryptBodyFromUrl: vi.fn() }));

import { getMessage } from "$lib/api/messages";
import type { MessageDetail } from "$lib/api/types";
import { decryptBodyFromUrl } from "./decrypt";
import { loadOriginalHeaders } from "./originalHeaders";

const fetchDetail = vi.mocked(getMessage);
const decrypt = vi.mocked(decryptBodyFromUrl);

function detail(url: string): MessageDetail {
  return { id: "m1", body: { url } } as MessageDetail;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("loadOriginalHeaders", () => {
  it("fetches the message, decrypts its body and returns the header block", async () => {
    fetchDetail.mockResolvedValue(detail("https://blob.example/one"));
    decrypt.mockResolvedValue({
      plaintext:
        "Received: from mx.example.com\r\n\tby thelemail\r\nFrom: a@example.com\r\nSubject: hi\r\n\r\nbody text",
    });
    const headers = await loadOriginalHeaders("acc-1", "m1");
    expect(headers).toBe(
      "Received: from mx.example.com\r\n\tby thelemail\r\nFrom: a@example.com\r\nSubject: hi",
    );
    expect(decrypt).toHaveBeenCalledWith("acc-1", "https://blob.example/one");
  });

  it("re-fetches a fresh download URL on every call", async () => {
    fetchDetail
      .mockResolvedValueOnce(detail("https://blob.example/one"))
      .mockResolvedValueOnce(detail("https://blob.example/two"));
    decrypt.mockResolvedValue({ plaintext: "From: a@example.com\n\nbody" });
    await loadOriginalHeaders("acc-1", "m1");
    await loadOriginalHeaders("acc-1", "m1");
    expect(fetchDetail).toHaveBeenCalledTimes(2);
    expect(decrypt.mock.calls.map((c) => c[1])).toEqual([
      "https://blob.example/one",
      "https://blob.example/two",
    ]);
  });

  it("keeps the outer headers of a PGP/MIME message", async () => {
    fetchDetail.mockResolvedValue(detail("https://blob.example/pgp"));
    decrypt.mockResolvedValue({
      plaintext:
        'From: a@example.com\nContent-Type: multipart/encrypted;\n boundary="b1"\n\n--b1\nContent-Type: application/pgp-encrypted\n\nVersion: 1\n',
    });
    expect(await loadOriginalHeaders("acc-1", "m1")).toBe(
      'From: a@example.com\nContent-Type: multipart/encrypted;\n boundary="b1"',
    );
  });

  it("returns an empty block when the payload carries no headers", async () => {
    fetchDetail.mockResolvedValue(detail("https://blob.example/raw"));
    decrypt.mockResolvedValue({ plaintext: "just a body" });
    expect(await loadOriginalHeaders("acc-1", "m1")).toBe("");
  });

  it("propagates decryption failures", async () => {
    fetchDetail.mockResolvedValue(detail("https://blob.example/one"));
    decrypt.mockRejectedValue(new Error("locked"));
    await expect(loadOriginalHeaders("acc-1", "m1")).rejects.toThrow("locked");
  });
});

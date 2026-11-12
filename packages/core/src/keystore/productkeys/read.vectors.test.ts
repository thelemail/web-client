// @vitest-environment node
import * as openpgp from "openpgp";
import { describe, expect, it } from "vitest";
import raw from "../../interop/vectors/product-keys-read-v1.json?raw";
import { utf8 } from "./canonical";
import { b64decode, sha256 } from "./encoding";
import { ProductKeysError } from "./errors";
import type { Product } from "./productBundle";
import type { ReadInput, StoredBundle } from "./read";
import { readProductKeys } from "./read";

const DIGEST =
  "ba71af45ec0ee3e1c18e1d35ce075f1d45b6a079afface8912edb13e8ec0a754";

interface BundleJSON {
  bundleId: string;
  revision: number;
  bundle: string;
}

interface SignedJSON {
  record: string;
  signature: string;
}

interface InputJSON {
  accountId: string;
  amk: string;
  keyPassword: string;
  mailKeys: string[];
  authorityKey: string;
  head: {
    raw: string;
    mac: string;
    previousHeadHash: string | null;
    authoritySignature: string | null;
    legacySignature: string | null;
    transitionSignature: string | null;
  };
  secretBundles: BundleJSON[];
  products: {
    product: Product;
    identityManifest: SignedJSON;
    delegation: SignedJSON & { signingPublicKey: string };
    dataManifest: SignedJSON[];
    bundles: BundleJSON[];
  }[];
}

interface Case {
  name: string;
  mode: "full" | "products";
  input: InputJSON;
  result?: unknown;
  error?: string;
}

const file = JSON.parse(raw) as { version: number; cases: Case[] };

const bytesOrNull = (s: string | null) => (s === null ? null : b64decode(s));
const bundles = (bs: BundleJSON[]): StoredBundle[] =>
  bs.map((b) => ({
    bundleId: b.bundleId,
    revision: b.revision,
    bundle: utf8(b.bundle),
  }));
const signed = (s: SignedJSON) => ({
  record: utf8(s.record),
  signature: b64decode(s.signature),
});

async function toInput(i: InputJSON): Promise<ReadInput> {
  return {
    accountId: i.accountId,
    amk: b64decode(i.amk),
    keyPassword: i.keyPassword,
    mailKeys: await Promise.all(
      i.mailKeys.map((k) => openpgp.readKey({ binaryKey: b64decode(k) })),
    ),
    authorityKey: b64decode(i.authorityKey),
    head: {
      raw: utf8(i.head.raw),
      mac: b64decode(i.head.mac),
      previousHeadHash: bytesOrNull(i.head.previousHeadHash),
      authority: bytesOrNull(i.head.authoritySignature),
      legacy: bytesOrNull(i.head.legacySignature),
      transition: bytesOrNull(i.head.transitionSignature),
    },
    secretBundles: bundles(i.secretBundles),
    products: i.products.map((p) => ({
      product: p.product,
      identityManifest: signed(p.identityManifest),
      delegation: {
        ...signed(p.delegation),
        signingPublicKey: b64decode(p.delegation.signingPublicKey),
      },
      dataManifest: p.dataManifest.map(signed),
      bundles: bundles(p.bundles),
    })),
  };
}

describe("product key read vectors", () => {
  it("is the file trust pins", async () => {
    const sum = await sha256(utf8(raw));
    expect(
      Array.from(sum, (b) => b.toString(16).padStart(2, "0")).join(""),
    ).toBe(DIGEST);
    expect(file.cases.filter((c) => c.mode === "full").length).toBeGreaterThan(
      0,
    );
  });

  for (const c of file.cases.filter((x) => x.mode === "full")) {
    it(c.name, async () => {
      const run = readProductKeys(await toInput(c.input));
      if (c.error) {
        await expect(run).rejects.toBeInstanceOf(ProductKeysError);
        await expect(run).rejects.toMatchObject({ code: c.error });
        return;
      }
      expect(await run).toEqual(c.result);
    });
  }
});

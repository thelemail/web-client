import type { SignatureVerdict } from "$lib/keystore/protocol";
import type { DirectoryTrust, ExternalKeyState } from "./senderVerify";
import type { AuthState, MessagePreviewAuth } from "./preview";
import { formatFingerprintHex, formatVerifiedAt } from "$lib/directory/format";

export type TrustTier =
  | "verified"
  | "encrypted"
  | "authenticated"
  | "none"
  | "attention"
  | "failed";

export type CheckState = "pass" | "absent" | "fail";

export interface TrustCheck {
  id: string;
  label: string;
  state: CheckState;
}

export interface TrustTechnicalRow {
  label: string;
  value: string;
}

export interface MessageTrust {
  tier: TrustTier;
  headline: string;
  label: string;
  checks: TrustCheck[];
  footnote?: string;
  technical: TrustTechnicalRow[];
  action?: "confirm_key_change";
  address?: string;
}

export type Channel = "internal" | "inbound_external" | "outbound_external";

export interface TrustFacts {
  channel: Channel;
  senderAddress: string;
  e2e: boolean;
  signature?: SignatureVerdict;
  directory?: DirectoryTrust | null;
  externalKey?: ExternalKeyState | null;
  domainAuth?: MessagePreviewAuth;
  domainAuthState?: AuthState;
  nowMillis: number;
}

const BLOCKING_DIRECTORY_CODES = new Set([
  "version_rolled_back",
  "tlog_tree_rolled_back",
  "tlog_inclusion_invalid",
  "tlog_checkpoint_unverified",
  "tlog_vrf_invalid",
]);

const FAILURE_HEADLINES: Record<string, string> = {
  signature_invalid: "Sender identity could not be verified",
  address_mismatch: "The directory answered for a different address",
  fingerprint_mismatch: "The served key does not match the signed record",
  algorithm_mismatch: "Unsupported key algorithm",
  signing_key_mismatch: "The directory record was signed by an unknown key",
  statement_malformed: "The directory record could not be read",
  version_rolled_back: "The directory record went backwards",
  tlog_proof_missing: "No transparency log proof was provided",
  tlog_proof_malformed: "The transparency log proof could not be read",
  tlog_checkpoint_unverified: "The transparency log checkpoint is not trusted",
  tlog_witness_policy_unmet: "Not enough witnesses confirmed the checkpoint",
  tlog_checkpoint_stale: "The transparency log checkpoint is out of date",
  tlog_inclusion_invalid: "The key is not included in the transparency log",
  tlog_vrf_invalid: "The transparency log entry does not match this address",
  tlog_tree_rolled_back: "The transparency log went backwards",
};

function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? address : address.slice(at + 1);
}

function relativeTime(fromMillis: number, nowMillis: number): string {
  const seconds = Math.max(0, Math.round((nowMillis - fromMillis) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function tlogRows(facts: TrustFacts): TrustTechnicalRow[] {
  const tlog = facts.directory?.tlog;
  if (!tlog) return [];
  if (tlog.state === "verified") {
    const rows: TrustTechnicalRow[] = [
      { label: "Log origin", value: tlog.origin },
      { label: "Tree size", value: String(tlog.treeSize) },
      { label: "Leaf index", value: String(tlog.leafIndex) },
      {
        label: "Witnesses",
        value: tlog.witnessThreshold
          ? `${tlog.validWitnessCount} of ${tlog.witnessThreshold} required`
          : `${tlog.validWitnessCount}, none required yet`,
      },
    ];
    if (tlog.cosignatureTimestamp) {
      rows.push({
        label: "Checkpoint cosigned",
        value: new Date(tlog.cosignatureTimestamp * 1000).toISOString(),
      });
    }
    return rows;
  }
  if (tlog.state === "failed") {
    const rows: TrustTechnicalRow[] = [
      { label: "Transparency log", value: tlog.code },
    ];
    if (tlog.details.logOrigin)
      rows.push({ label: "Log origin", value: tlog.details.logOrigin });
    if (tlog.details.treeSize !== undefined) {
      rows.push({ label: "Tree size", value: String(tlog.details.treeSize) });
    }
    if (tlog.details.validWitnessCount !== undefined) {
      rows.push({
        label: "Witnesses",
        value: `${tlog.details.validWitnessCount} of ${tlog.details.witnessThreshold ?? 0} required`,
      });
    }
    return rows;
  }
  return [
    { label: "Transparency log", value: "not configured on this client" },
  ];
}

function directoryRows(facts: TrustFacts): TrustTechnicalRow[] {
  const dir = facts.directory;
  if (!dir) return [];
  const rows: TrustTechnicalRow[] = [];
  if (dir.statement) {
    rows.push({
      label: "Sender key",
      value: formatFingerprintHex(dir.statement.keyFingerprint),
    });
    rows.push({
      label: "Directory record",
      value: formatVerifiedAt(
        Date.parse(dir.statement.issuedAt),
        dir.statement.version,
      ),
    });
    rows.push({
      label: "Directory signing key",
      value: formatFingerprintHex(dir.statement.signingKeyFingerprint),
    });
  }
  if (dir.details?.previousFingerprint) {
    rows.push({
      label: "Previously pinned",
      value: formatFingerprintHex(dir.details.previousFingerprint),
    });
  }
  if (dir.details?.currentFingerprint) {
    rows.push({
      label: "Now",
      value: formatFingerprintHex(dir.details.currentFingerprint),
    });
  }
  return rows;
}

function signatureRows(facts: TrustFacts): TrustTechnicalRow[] {
  const sig = facts.signature;
  if (!sig || sig.state === "none") return [];
  const rows: TrustTechnicalRow[] = [{ label: "Signature", value: sig.state }];
  if (sig.keyFingerprintHex) {
    rows.push({
      label: "Signing key",
      value: formatFingerprintHex(sig.keyFingerprintHex),
    });
  }
  if (sig.signedAtMillis) {
    rows.push({
      label: "Signed at",
      value: new Date(sig.signedAtMillis).toISOString(),
    });
  }
  return rows;
}

function domainRows(facts: TrustFacts): TrustTechnicalRow[] {
  const auth = facts.domainAuth;
  if (!auth) return [];
  const rows: TrustTechnicalRow[] = [];
  if (auth.spf) rows.push({ label: "SPF", value: auth.spf });
  if (auth.dkim) rows.push({ label: "DKIM", value: auth.dkim });
  if (auth.dmarc) rows.push({ label: "DMARC", value: auth.dmarc });
  return rows;
}

function technicalFor(facts: TrustFacts): TrustTechnicalRow[] {
  return [
    ...directoryRows(facts),
    ...signatureRows(facts),
    ...tlogRows(facts),
    ...domainRows(facts),
  ];
}

function witnessesMet(facts: TrustFacts): boolean {
  const tlog = facts.directory?.tlog;
  if (!tlog || tlog.state !== "verified") return false;
  return (
    tlog.witnessThreshold >= 1 &&
    tlog.validWitnessCount >= tlog.witnessThreshold
  );
}

function internalChecks(facts: TrustFacts): TrustCheck[] {
  const dir = facts.directory;
  const tlog = dir?.tlog;
  const sig = facts.signature?.state;
  return [
    {
      id: "e2e",
      label: "Message is end-to-end encrypted",
      state: facts.e2e ? "pass" : "absent",
    },
    {
      id: "signature",
      label: "Message signature is valid",
      state: sig === "valid" ? "pass" : sig === "invalid" ? "fail" : "absent",
    },
    {
      id: "binding",
      label: "Sender address matches the signing key",
      state: sig === "valid" && dir?.ok ? "pass" : "absent",
    },
    {
      id: "tlog",
      label: "Key is recorded in the transparency log",
      state:
        tlog?.state === "verified"
          ? "pass"
          : tlog?.state === "failed"
            ? "fail"
            : "absent",
    },
    {
      id: "witnesses",
      label: "Checkpoint confirmed by independent witnesses",
      state: witnessesMet(facts) ? "pass" : "absent",
    },
    {
      id: "keychange",
      label: "No unexpected key change was detected",
      state: dir?.ok ? "pass" : "fail",
    },
  ];
}

function externalAuthChecks(facts: TrustFacts): TrustCheck[] {
  const domain = domainOf(facts.senderAddress);
  const passed = facts.domainAuthState === "pass";
  return [
    {
      id: "domain",
      label: "Message passed domain authentication",
      state: passed
        ? "pass"
        : facts.domainAuthState === "fail"
          ? "fail"
          : "absent",
    },
    {
      id: "claim",
      label: `Message claims to come from ${domain}`,
      state: passed ? "pass" : "absent",
    },
    { id: "e2e", label: "Not end-to-end encrypted", state: "absent" },
    {
      id: "identity",
      label: "Individual sender identity not cryptographically verified",
      state: "absent",
    },
    { id: "tlog", label: "Key transparency not available", state: "absent" },
  ];
}

function externalEncryptedChecks(facts: TrustFacts): TrustCheck[] {
  const pinned = facts.externalKey?.status === "pinned";
  return [
    {
      id: "e2e",
      label: "Message encrypted to this recipient's key",
      state: "pass",
    },
    {
      id: "pinned",
      label: "Key matches the one previously used on this device",
      state: pinned ? "pass" : "absent",
    },
    {
      id: "tlog",
      label: "Key is not covered by Thelemail transparency",
      state: "absent",
    },
    {
      id: "witnesses",
      label: "Independent witnesses cannot confirm this key",
      state: "absent",
    },
  ];
}

export function deriveTrust(facts: TrustFacts): MessageTrust {
  const technical = technicalFor(facts);
  const base = { technical, address: facts.senderAddress };
  const dir = facts.directory;

  if (facts.signature?.state === "invalid") {
    return {
      ...base,
      tier: "failed",
      label: "Signature invalid",
      headline: "The signature on this message is not valid",
      checks: internalChecks(facts),
      footnote:
        "This message was not signed by the key the directory publishes for the sender.",
    };
  }

  if (dir && !dir.ok && dir.code) {
    const changedUpwards =
      dir.code === "fingerprint_changed" &&
      (dir.details?.currentVersion ?? 0) > (dir.details?.previousVersion ?? 0);
    if (changedUpwards) {
      return {
        ...base,
        tier: "attention",
        label: "Key changed",
        headline: "The sender's key has changed since you last saw it",
        checks: internalChecks(facts),
        footnote: dir.details?.previousVerifiedAtMillis
          ? `Last verified ${relativeTime(dir.details.previousVerifiedAtMillis, facts.nowMillis)}`
          : undefined,
        action: "confirm_key_change",
      };
    }
    const blocking = BLOCKING_DIRECTORY_CODES.has(dir.code);
    return {
      ...base,
      tier: "failed",
      label: blocking ? "Verification failed" : "Could not verify",
      headline:
        FAILURE_HEADLINES[dir.code] ?? "Sender identity could not be verified",
      checks: internalChecks(facts),
    };
  }

  if (facts.domainAuthState === "fail") {
    return {
      ...base,
      tier: "failed",
      label: "Authentication failed",
      headline: "This message failed domain authentication",
      checks: externalAuthChecks(facts),
      footnote: `The sending server could not prove it speaks for ${domainOf(facts.senderAddress)}.`,
    };
  }

  if (facts.externalKey?.status === "changed") {
    return {
      ...base,
      tier: "attention",
      label: "Key changed",
      headline: "This sender's encryption key has changed",
      checks: externalEncryptedChecks(facts),
      footnote: facts.externalKey.fingerprint
        ? `New key · ${formatFingerprintHex(facts.externalKey.fingerprint)}`
        : undefined,
      action: "confirm_key_change",
    };
  }

  const fullPolicy = Boolean(
    facts.e2e &&
      facts.signature?.state === "valid" &&
      dir?.ok &&
      dir.tlog.state === "verified" &&
      witnessesMet(facts),
  );

  if (fullPolicy) {
    return {
      ...base,
      tier: "verified",
      label: "Encrypted and verified",
      headline: "Encrypted and verified",
      checks: internalChecks(facts),
      footnote: dir?.verifiedAtMillis
        ? `Verified on this device · ${relativeTime(dir.verifiedAtMillis, facts.nowMillis)}`
        : undefined,
    };
  }

  if (facts.e2e) {
    const external = facts.channel !== "internal";
    return {
      ...base,
      tier: "encrypted",
      label: "End-to-end encrypted",
      headline: "End-to-end encrypted",
      checks: external ? externalEncryptedChecks(facts) : internalChecks(facts),
      footnote: external
        ? facts.externalKey?.fingerprint
          ? `Key remembered · ${formatFingerprintHex(facts.externalKey.fingerprint)}`
          : "Key remembered on this device"
        : dir?.verifiedAtMillis
          ? `Verified on this device · ${relativeTime(dir.verifiedAtMillis, facts.nowMillis)}`
          : undefined,
    };
  }

  if (facts.domainAuthState === "pass") {
    return {
      ...base,
      tier: "authenticated",
      label: "Sender domain authenticated",
      headline: "Sender domain authenticated",
      checks: externalAuthChecks(facts),
      footnote: "Protected in transit where supported",
    };
  }

  return {
    ...base,
    tier: "none",
    label: "Not authenticated",
    headline: "Sender domain not authenticated",
    checks: externalAuthChecks(facts),
    footnote:
      "Nothing failed. The sending domain simply published no way to check.",
  };
}

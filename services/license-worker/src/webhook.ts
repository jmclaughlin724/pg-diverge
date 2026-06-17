import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook signature verification (task M30 — issuance side). Verifies the
 * `Stripe-Signature` header over the RAW request body before any parsing (Rule 15:
 * webhooks verify signatures over raw bodies; enforce a replay window). HMAC-SHA256
 * with the endpoint signing secret, constant-time compared.
 */

const DEFAULT_TOLERANCE_SECONDS = 300;

function parseSignatureHeader(header: string): { timestamp: string; v1: string } | null {
  let timestamp: string | undefined;
  let v1: string | undefined;
  for (const segment of header.split(",")) {
    const splitAt = segment.indexOf("=");
    if (splitAt <= 0) {
      continue;
    }
    const key = segment.slice(0, splitAt);
    const value = segment.slice(splitAt + 1);
    if (key === "t") {
      timestamp = value;
    } else if (key === "v1") {
      v1 = value;
    }
  }
  if (timestamp === undefined || v1 === undefined) {
    return null;
  }
  return { timestamp, v1 };
}

export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowSeconds: number,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS
): boolean {
  const parsed = parseSignatureHeader(signatureHeader);
  if (parsed === null) {
    return false;
  }
  const age = nowSeconds - Number(parsed.timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest("hex");
  // Compare the raw digest bytes (hex-decoded), not the UTF-8 bytes of the hex
  // string; a malformed non-hex `v1` decodes to a different length and is rejected.
  const expectedBytes = Buffer.from(expected, "hex");
  const providedBytes = Buffer.from(parsed.v1, "hex");
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, providedBytes);
}

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_SECONDS = 300;

function parseSignatureHeader(header: string): { signatures: string[]; timestamp: string } | null {
  const signatures: string[] = [];
  let timestamp: string | undefined;
  for (const rawSegment of header.split(",")) {
    const segment = rawSegment.trim();
    const splitAt = segment.indexOf("=");
    if (splitAt <= 0) {
      continue;
    }
    const key = segment.slice(0, splitAt);
    const value = segment.slice(splitAt + 1);
    if (key === "t") {
      timestamp = value;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }
  if (timestamp === undefined || signatures.length === 0) {
    return null;
  }
  return { signatures, timestamp };
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

  const expectedBytes = Buffer.from(expected, "hex");
  return parsed.signatures.some((signature) => {
    const providedBytes = Buffer.from(signature, "hex");
    return (
      expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
    );
  });
}

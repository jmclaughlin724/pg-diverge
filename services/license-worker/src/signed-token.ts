import { createPublicKey, type KeyObject, sign, verify } from "node:crypto";

interface SignedTokenHeader {
  alg: "EdDSA";
  typ: string;
}

function base64Url(input: Buffer): string {
  return input.toString("base64url");
}

function base64UrlToBuffer(part: string): Buffer {
  return Buffer.from(part, "base64url");
}

function isExpectedHeader(value: unknown, expectedType: string): value is SignedTokenHeader {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "alg") === "EdDSA" &&
    Reflect.get(value, "typ") === expectedType
  );
}

export function issueSignedToken(
  type: string,
  claims: Readonly<object>,
  privateKey: KeyObject
): string {
  const header = base64Url(Buffer.from(JSON.stringify({ alg: "EdDSA", typ: type })));
  const payload = base64Url(Buffer.from(JSON.stringify(claims)));
  const signature = base64Url(sign(null, Buffer.from(`${header}.${payload}`), privateKey));
  return `${header}.${payload}.${signature}`;
}

export function verifySignedToken(
  token: string,
  expectedType: string,
  publicKeyPem: string
): unknown | null {
  const parts = token.split(".");
  const [headerPart, payloadPart, signaturePart] = parts;
  if (
    parts.length !== 3 ||
    headerPart === undefined ||
    payloadPart === undefined ||
    signaturePart === undefined
  ) {
    return null;
  }
  try {
    const header: unknown = JSON.parse(base64UrlToBuffer(headerPart).toString("utf8"));
    if (!isExpectedHeader(header, expectedType)) {
      return null;
    }
    const publicKey = createPublicKey(publicKeyPem);
    if (
      publicKey.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(`${headerPart}.${payloadPart}`),
        publicKey,
        base64UrlToBuffer(signaturePart)
      )
    ) {
      return null;
    }
    return JSON.parse(base64UrlToBuffer(payloadPart).toString("utf8"));
  } catch {
    return null;
  }
}

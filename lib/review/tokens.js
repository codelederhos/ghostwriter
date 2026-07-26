import crypto from "crypto";

function deterministicToken(prefix, postId) {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY fehlt — Review-Tokens nicht ableitbar");
  }
  const mac = crypto
    .createHmac("sha256", process.env.ENCRYPTION_KEY)
    .update(`${prefix}:${postId}`)
    .digest("hex")
    .slice(0, 24);
  return `${prefix === "publish" ? "pub" : "adm"}-${postId}-${mac}`;
}

export function adminPreviewToken(postId) {
  return deterministicToken("preview", postId);
}

export function adminPublishToken(postId) {
  return deterministicToken("publish", postId);
}

export function postIdFromDeterministicToken(kind, token) {
  const match = String(token).match(/^(adm|pub)-([0-9a-f-]{36})-([0-9a-f]{24})$/i);
  if (!match) return null;
  if (kind === "publish" && match[1] !== "pub") return null;
  if (kind === "preview" && match[1] !== "adm") return null;
  const expected = deterministicToken(kind, match[2]);
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  return match[2];
}

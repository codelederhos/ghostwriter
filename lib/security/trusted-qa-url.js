import dns from "node:dns/promises";
import net from "node:net";

function ipv4Parts(value) {
  const parts = String(value).split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

export function isPrivateOrSpecialIp(value) {
  const address = String(value || "").trim().toLowerCase();
  if (!net.isIP(address)) return true;

  if (address.startsWith("::ffff:")) {
    return isPrivateOrSpecialIp(address.slice(7));
  }

  if (net.isIPv4(address)) {
    const [a, b] = ipv4Parts(address);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }

  return address === "::"
    || address === "::1"
    || address.startsWith("fc")
    || address.startsWith("fd")
    || /^fe[89ab]/.test(address)
    || address.startsWith("ff")
    || address.startsWith("2001:db8:");
}

function originFromDomain(domain) {
  if (!domain) return null;
  try {
    return new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`).origin;
  } catch {
    return null;
  }
}

function normalizedPath(value) {
  const path = String(value || "/").replace(/\/{2,}/g, "/");
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export async function validateTrustedQaUrl({
  candidate,
  tenantDomain,
  baseUrl,
  tenantSlug,
  language,
  blogSlug,
  lookup = dns.lookup,
}) {
  let url;
  try {
    url = new URL(String(candidate || ""));
  } catch {
    throw new Error("Ungültige veröffentlichte Blog-URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("QA-URL muss eine vertrauenswürdige HTTPS-URL ohne Zugangsdaten oder Sonderport sein");
  }

  const tenantOrigin = originFromDomain(tenantDomain);
  const baseOrigin = originFromDomain(baseUrl);
  const allowed = new Map();
  if (tenantOrigin && blogSlug) {
    allowed.set(tenantOrigin, normalizedPath(`/blog/${blogSlug}`));
  }
  if (baseOrigin && tenantSlug && language && blogSlug) {
    allowed.set(baseOrigin, normalizedPath(`/${tenantSlug}/${language}/blog/${blogSlug}`));
  }

  const expectedPath = allowed.get(url.origin);
  if (!expectedPath || normalizedPath(url.pathname) !== expectedPath) {
    throw new Error("QA-URL stimmt nicht mit der veröffentlichten Tenant-URL überein");
  }

  const resolved = await lookup(url.hostname, { all: true, verbatim: true });
  const addresses = Array.isArray(resolved) ? resolved : [resolved];
  if (!addresses.length || addresses.some((entry) => isPrivateOrSpecialIp(entry?.address))) {
    throw new Error("QA-URL löst auf eine private oder reservierte Adresse auf");
  }
  return url.href;
}

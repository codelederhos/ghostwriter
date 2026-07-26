import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateOrSpecialIp, validateTrustedQaUrl } from "../lib/security/trusted-qa-url.js";

test("private, link-local and metadata addresses are rejected", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.20.1.1", "192.168.1.1", "::1", "fd00::1"]) {
    assert.equal(isPrivateOrSpecialIp(address), true, address);
  }
  assert.equal(isPrivateOrSpecialIp("203.0.114.8"), false);
});

test("QA target must match the exact tenant article URL", async () => {
  const lookup = async () => [{ address: "203.0.114.8", family: 4 }];
  const accepted = await validateTrustedQaUrl({
    candidate: "https://example.test/blog/mein-artikel/",
    tenantDomain: "example.test",
    baseUrl: "https://ghostwriter.example.test",
    tenantSlug: "kunde",
    language: "de",
    blogSlug: "mein-artikel",
    lookup,
  });
  assert.equal(accepted, "https://example.test/blog/mein-artikel/");

  await assert.rejects(
    validateTrustedQaUrl({
      candidate: "https://attacker.test/internal",
      tenantDomain: "example.test",
      baseUrl: "https://ghostwriter.example.test",
      tenantSlug: "kunde",
      language: "de",
      blogSlug: "mein-artikel",
      lookup,
    }),
    /stimmt nicht/
  );
});

test("QA target fails closed when DNS resolves privately", async () => {
  await assert.rejects(
    validateTrustedQaUrl({
      candidate: "https://example.test/blog/mein-artikel",
      tenantDomain: "example.test",
      blogSlug: "mein-artikel",
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    }),
    /private oder reservierte/
  );
});

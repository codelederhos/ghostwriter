import test from "node:test";
import assert from "node:assert/strict";
import { buildArticleImageHtml, normalizePublishedMediaHtml } from "../lib/pipeline/media-contract.js";

test("article images receive a responsive intrinsic contract", () => {
  const html = buildArticleImageHtml({ src: "https://example.test/x.webp", alt: "Bild" });
  assert.match(html, /width="1600"/);
  assert.match(html, /height="900"/);
  assert.match(html, /width:100%/);
  assert.match(html, /height:auto/);
  assert.match(html, /decoding="async"/);
});

test("legacy article and chart images are normalized without changing their src", () => {
  const input = [
    '<figure class="article-figure"><img src="/a.webp" height="768"></figure>',
    '<div class="gw-chart"><img src="/c.png" width="800" height="480"></div>',
  ].join("");
  const output = normalizePublishedMediaHtml(input);
  assert.match(output, /src="\/a\.webp"/);
  assert.match(output, /src="\/c\.png"/);
  assert.equal((output.match(/height:auto/g) || []).length, 2);
  assert.equal((output.match(/decoding="async"/g) || []).length, 2);
});

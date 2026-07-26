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

test("normalization handles unquoted attributes, nesting and is idempotent", () => {
  const input = [
    "<FIGURE class=article-figure><span><img src=/a.webp style='height:420px;width:50%;color:red'></span></FIGURE>",
    "<div class='gw-chart'><div><img src=/c.png class=chart-img loading=eager /></div></div>",
  ].join("");
  const once = normalizePublishedMediaHtml(input);
  const twice = normalizePublishedMediaHtml(once);
  assert.equal(twice, once);
  assert.match(once, /class="article-figure gw-media"/i);
  assert.match(once, /src=\/a\.webp/);
  assert.match(once, /color:red/);
  assert.equal((once.match(/height:auto/g) || []).length, 2);
  assert.equal((once.match(/object-fit:contain/g) || []).length, 1);
  assert.equal((once.match(/loading="lazy"/g) || []).length, 2);
});

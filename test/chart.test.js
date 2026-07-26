import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChartEmbedHtml,
  getChartTheme,
  validateChartConfig,
} from "../lib/pipeline/steps/chart.js";

const config = {
  type: "bar",
  data: { labels: ["A", "B"], datasets: [{ label: "Wert", data: [1, 2] }] },
  unit: "%",
  source_ids: [1],
};

test("charts require a unit and matching research sources", () => {
  assert.equal(validateChartConfig({ ...config, unit: "" }, { sources: [{ id: 1 }] }).ok, false);
  assert.equal(validateChartConfig(config, { sources: [{ id: 1, url: "https://example.test", title: "Quelle" }] }).ok, true);
  assert.equal(validateChartConfig(config, { sources: [{ id: 2, url: "https://example.test" }] }).ok, false);
});

test("chart embed is responsive and exposes provenance", () => {
  const html = buildChartEmbedHtml({
    title: "Vergleich",
    imgSrc: "/chart.png",
    unit: "%",
    sources: [{ url: "https://example.test", title: "Quelle" }],
  });
  assert.match(html, /height:auto/);
  assert.match(html, /Einheit: %/);
  assert.match(html, /Quelle/);
  assert.match(html, /<figcaption/);
});

test("known tenants receive distinct palettes", () => {
  assert.notDeepEqual(getChartTheme({ slug: "staned" }).palette, getChartTheme({ slug: "baur-immobilien" }).palette);
});

test("inline chart JSON cannot break out of its script element", () => {
  const html = buildChartEmbedHtml({
    title: "Sicher",
    configJson: '{"label":"</script><img src=x onerror=alert(1)>"}',
    sources: [
      { url: "javascript:alert(1)", title: "Unsicher" },
      { url: "https://example.test/source", title: "Sicher" },
    ],
  });
  assert.doesNotMatch(html, /<\/script><img/i);
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /https:\/\/example\.test\/source/);
});

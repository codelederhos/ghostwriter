/**
 * Chart-Step: Generiert Diagramme via QuickChart (self-hosted)
 * Wird vom Writer mit chart_config angefordert wenn sinnvoll.
 *
 * Unterstützte Typen: bar, horizontalBar (→ bar + indexAxis y), line, doughnut, pie, radar
 *
 * Render-Regeln (2026-07-12, nach Stani-Feedback zu unbrauchbaren PNGs):
 *   - KEIN Titel im Bild — Titel wird als HTML (.gw-chart__title) ÜBER dem Bild gerendert
 *   - Legende nur bei >1 Dataset (sonst redundant zum Titel)
 *   - KEINE Achsen-Titel (ragen ins Chart rein)
 *   - y beginnt bei 0 mit etwas grace, X-Ticks: autoSkip, maxRotation 30, font 12
 *   - 800x480 statt 800x420 (nicht so flach), devicePixelRatio 2 (Schärfe), layout padding 16
 */

import { writeFile, mkdir } from "fs/promises";
import path from "path";

const QUICKCHART_URL = process.env.QUICKCHART_URL || "http://quickchart:3400";
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/**
 * Generiert ein Chart-Bild via QuickChart und speichert es lokal.
 * @param {object} chartConfig - Chart.js-kompatible Config { type, data, options?, title? }
 * @param {string} slug - Für Dateiname
 * @param {number} width - Breite in Pixel (default 800)
 * @param {number} height - Höhe in Pixel (default 480)
 * @returns {{ url: string, localPath: string } | null}
 */
export async function generateChart(chartConfig, slug, width = 800, height = 480) {
  if (!chartConfig?.type || !chartConfig?.data) return null;

  try {
    // Farb- und Options-Defaults (Titel raus, Legende nur bei >1 Dataset, saubere Achsen)
    ensureChartColors(chartConfig);

    const payload = {
      chart: JSON.stringify(chartConfig),
      width,
      height,
      devicePixelRatio: 2, // Retina-Schärfe
      backgroundColor: "white",
      format: "png",
      version: "3", // Chart.js v3 — Config nutzt options.plugins.*-Syntax
    };

    const res = await fetch(`${QUICKCHART_URL}/chart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`QuickChart ${res.status}: ${err.slice(0, 200)}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${slug}-chart-${Date.now()}.png`;
    await writeFile(path.join(UPLOAD_DIR, filename), buffer);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
    const localPath = `/uploads/${filename}`;
    return { url: `${baseUrl}${localPath}`, localPath };
  } catch (e) {
    console.warn(`[ChartStep] Failed: ${e.message}`);
    return null;
  }
}

/**
 * Liest den Diagramm-Titel aus der Config, OHNE ihn im Bild zu rendern.
 * Der Titel gehört als HTML (.gw-chart__title) über das Bild.
 * Vor UND nach ensureChartColors aufrufbar (config.title bleibt erhalten).
 * @returns {string|null}
 */
export function extractChartTitle(config) {
  let t = config?.title ?? config?.options?.plugins?.title?.text ?? null;
  if (Array.isArray(t)) t = t.join(" ");
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * Baut das Embed-HTML für ein Chart: Titel als HTML über dem Bild.
 * Zwei Varianten:
 *   - imgSrc gesetzt  → statisches PNG (QuickChart)
 *   - configJson gesetzt → inline Chart.js (client-seitig gerendert, Fallback)
 */
export function buildChartEmbedHtml({ title, imgSrc, alt, configJson, width = 800, height = 480 }) {
  const titleHtml = title ? `<p class="gw-chart__title">${escapeHtml(title)}</p>` : "";
  if (imgSrc) {
    const altText = alt || title || "Diagramm";
    return `<div class="gw-chart">${titleHtml}<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(altText)}" width="${width}" height="${height}" loading="lazy"></div>`;
  }
  return `<div class="gw-chart">${titleHtml}<script type="application/json" class="gw-chart-config">${configJson}<\/script></div>`;
}

/**
 * Setzt Default-Farben + saubere Render-Optionen für Charts.
 * Mutiert die Config. Exportiert, damit Pipeline/Skripte dieselben Regeln nutzen.
 */
export function ensureChartColors(config) {
  const PALETTE = [
    "#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed",
    "#0891b2", "#be185d", "#065f46", "#92400e", "#1e3a5f",
  ];

  // horizontalBar (Chart.js v2) → bar + indexAxis "y" (v3+)
  if (config.type === "horizontalBar") {
    config.type = "bar";
    if (!config.options) config.options = {};
    config.options.indexAxis = "y";
  }

  const datasets = config?.data?.datasets || [];
  for (const [i, ds] of datasets.entries()) {
    const color = PALETTE[i % PALETTE.length];
    if (!ds.backgroundColor) {
      // Balken/Donut: Farbfüllung
      if (["bar", "doughnut", "pie", "polarArea"].includes(config.type)) {
        ds.backgroundColor = datasets.length === 1
          ? PALETTE.map(c => c + "dd")
          : color + "cc";
      } else {
        ds.backgroundColor = color + "22"; // Linie/Radar: transparenter Hintergrund
      }
    }
    if (!ds.borderColor && ["line", "radar"].includes(config.type)) {
      ds.borderColor = color;
      ds.borderWidth = ds.borderWidth ?? 2;
      ds.pointRadius = ds.pointRadius ?? 4;
      ds.tension = ds.tension ?? 0.3;
    }
  }

  const opts = (config.options = config.options || {});

  // Luft an den Rändern, damit nichts abgeschnitten wird
  opts.layout = opts.layout || {};
  if (opts.layout.padding == null) opts.layout.padding = 16;

  opts.plugins = opts.plugins || {};

  // Titel NIE im Bild rendern — kollidiert mit Legende. Text für HTML-Embed sichern.
  if (opts.plugins.title?.text && !config.title) config.title = opts.plugins.title.text;
  opts.plugins.title = { display: false };

  // Legende nur bei mehreren Datasets
  const showLegend = datasets.length > 1;
  opts.plugins.legend = showLegend
    ? {
        display: true,
        position: "bottom",
        labels: { font: { size: 12, family: "Inter, sans-serif" }, boxWidth: 14, padding: 12 },
      }
    : { display: false };

  // Achsen-Defaults
  if (config.type === "bar" || config.type === "line") {
    const horizontal = opts.indexAxis === "y";
    const valueAxis = horizontal ? "x" : "y";
    const categoryAxis = horizontal ? "y" : "x";
    opts.scales = opts.scales || {};
    opts.scales[valueAxis] = {
      ...(opts.scales[valueAxis] || {}),
      beginAtZero: true,
      grace: "5%",
      title: { display: false }, // Achsen-Titel ragen ins Chart — immer aus
      ticks: { ...(opts.scales[valueAxis]?.ticks || {}), font: { size: 12 } },
    };
    opts.scales[categoryAxis] = {
      ...(opts.scales[categoryAxis] || {}),
      title: { display: false },
      ticks: {
        ...(opts.scales[categoryAxis]?.ticks || {}),
        autoSkip: true,
        maxRotation: 30,
        minRotation: 0,
        font: { size: 12 },
      },
    };
  } else if (config.type === "radar") {
    opts.scales = opts.scales || {};
    opts.scales.r = {
      ...(opts.scales.r || {}),
      beginAtZero: true,
      ticks: { ...(opts.scales.r?.ticks || {}), font: { size: 11 } },
      pointLabels: { ...(opts.scales.r?.pointLabels || {}), font: { size: 12 } },
    };
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
export async function generateChart(chartConfig, slug, width = 800, height = 480, theme = {}) {
  if (!chartConfig?.type || !chartConfig?.data) return null;

  try {
    // Farb- und Options-Defaults (Titel raus, Legende nur bei >1 Dataset, saubere Achsen)
    ensureChartColors(chartConfig, theme);

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
export function buildChartEmbedHtml({
  title,
  imgSrc,
  alt,
  configJson,
  width = 800,
  height = 480,
  unit,
  sources = [],
}) {
  const titleHtml = title ? `<p class="gw-chart__title">${escapeHtml(title)}</p>` : "";
  const sourceLinks = sources
    .map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a>`)
    .join(", ");
  const metaParts = [
    unit ? `Einheit: ${escapeHtml(unit)}` : null,
    sourceLinks ? `Quelle: ${sourceLinks}` : null,
  ].filter(Boolean);
  const metaHtml = metaParts.length
    ? `<figcaption class="gw-chart__meta">${metaParts.join(" · ")}</figcaption>`
    : "";
  if (imgSrc) {
    const altText = alt || title || "Diagramm";
    return `<figure class="gw-chart">${titleHtml}<img class="gw-responsive-media" src="${escapeHtml(imgSrc)}" alt="${escapeHtml(altText)}" width="${width}" height="${height}" loading="lazy" decoding="async" style="display:block;width:100%;max-width:100%;height:auto;object-fit:contain">${metaHtml}</figure>`;
  }
  return `<figure class="gw-chart">${titleHtml}<script type="application/json" class="gw-chart-config">${configJson}<\/script>${metaHtml}</figure>`;
}

/**
 * Setzt Default-Farben + saubere Render-Optionen für Charts.
 * Mutiert die Config. Exportiert, damit Pipeline/Skripte dieselben Regeln nutzen.
 */
export function ensureChartColors(config, theme = {}) {
  const PALETTE = theme.palette || [
    "#1d4ed8", "#0f766e", "#b45309", "#7e22ce", "#be123c",
    "#0369a1", "#4d7c0f", "#9f1239", "#4338ca", "#334155",
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
  if (opts.layout.padding == null) opts.layout.padding = 24;

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
        labels: { color: theme.text || "#1e293b", font: { size: 12, family: "Inter, sans-serif", weight: "600" }, boxWidth: 14, padding: 16 },
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
      grid: { color: theme.grid || "rgba(148,163,184,0.22)", drawBorder: false },
      ticks: { ...(opts.scales[valueAxis]?.ticks || {}), color: theme.textMuted || "#64748b", font: { size: 12, family: "Inter, sans-serif" } },
    };
    opts.scales[categoryAxis] = {
      ...(opts.scales[categoryAxis] || {}),
      title: { display: false },
      ticks: {
        ...(opts.scales[categoryAxis]?.ticks || {}),
        autoSkip: true,
        maxRotation: 30,
        minRotation: 0,
        color: theme.textMuted || "#64748b",
        font: { size: 12, family: "Inter, sans-serif", weight: "600" },
      },
      grid: { display: false, drawBorder: false },
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

export function getChartTheme(tenant = {}) {
  const key = `${tenant?.slug || ""} ${tenant?.domain || ""}`.toLowerCase();
  if (key.includes("staned")) {
    return {
      palette: ["#059669", "#0f766e", "#0284c7", "#65a30d", "#7c3aed"],
      text: "#0f172a",
      textMuted: "#475569",
      grid: "rgba(5,150,105,0.16)",
    };
  }
  if (key.includes("baur") || key.includes("immobilien")) {
    return {
      palette: ["#9a7b32", "#c3a75d", "#5f6f52", "#8b5e3c", "#475569"],
      text: "#29251d",
      textMuted: "#6b6254",
      grid: "rgba(154,123,50,0.18)",
    };
  }
  if (key.includes("code-lederhos")) {
    return {
      palette: ["#d4af37", "#45f882", "#3b82f6", "#a78bfa", "#f97316"],
      text: "#111827",
      textMuted: "#4b5563",
      grid: "rgba(212,175,55,0.18)",
    };
  }
  return {};
}

/**
 * Diagramme ohne Einheit und nachvollziehbare Research-Quelle werden nicht
 * publiziert. So sehen beliebige Modellzahlen nicht länger wie Fakten aus.
 */
export function validateChartConfig(config, research) {
  if (!config?.type || !config?.data || !Array.isArray(config?.data?.labels)) {
    return { ok: false, reason: "Chart-Struktur unvollständig" };
  }
  const datasets = Array.isArray(config.data.datasets) ? config.data.datasets : [];
  if (!datasets.length || datasets.some((set) => !Array.isArray(set?.data) || set.data.some((value) => !Number.isFinite(Number(value))))) {
    return { ok: false, reason: "Chart-Daten fehlen oder sind nicht numerisch" };
  }
  if (datasets.some((set) => set.data.length !== config.data.labels.length)) {
    return { ok: false, reason: "Chart-Labels und Datenlängen passen nicht zusammen" };
  }

  const unit = String(config.unit || "").trim();
  const sourceIds = Array.isArray(config.source_ids)
    ? [...new Set(config.source_ids.map(Number).filter(Number.isFinite))]
    : [];
  const researchSources = Array.isArray(research?.sources) ? research.sources : [];
  const sources = sourceIds
    .map((id) => researchSources.find((source) => Number(source.id) === id))
    .filter(Boolean);

  if (!unit) return { ok: false, reason: "Chart-Einheit fehlt" };
  if (!sourceIds.length || sources.length !== sourceIds.length) {
    return { ok: false, reason: "Chart-Quellen fehlen oder sind nicht im Research belegt" };
  }
  return { ok: true, unit, sources };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Chart-Step: Generiert Diagramme via QuickChart (self-hosted)
 * Wird vom Writer mit chart_config angefordert wenn sinnvoll.
 *
 * Unterstützte Typen: bar, horizontalBar, line, doughnut, pie, radar
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
 * @param {number} height - Höhe in Pixel (default 400)
 * @returns {{ url: string, localPath: string } | null}
 */
export async function generateChart(chartConfig, slug, width = 800, height = 420) {
  if (!chartConfig?.type || !chartConfig?.data) return null;

  try {
    // Farb-Defaults wenn nicht gesetzt (primäre Brand-Farben)
    ensureChartColors(chartConfig);

    const payload = {
      chart: JSON.stringify(chartConfig),
      width,
      height,
      backgroundColor: "white",
      format: "png",
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
 * Setzt Default-Farben für Charts wenn keine definiert.
 * Moderne, klare Palette passend zu professionellen Blogs.
 */
function ensureChartColors(config) {
  const PALETTE = [
    "#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed",
    "#0891b2", "#be185d", "#065f46", "#92400e", "#1e3a5f",
  ];
  const datasets = config?.data?.datasets || [];
  for (const [i, ds] of datasets.entries()) {
    const color = PALETTE[i % PALETTE.length];
    if (!ds.backgroundColor) {
      // Balken/Donut: Farbfüllung
      if (["bar", "horizontalBar", "doughnut", "pie", "polarArea"].includes(config.type)) {
        ds.backgroundColor = datasets.length === 1
          ? PALETTE.map(c => c + "dd")
          : color + "cc";
      } else {
        ds.backgroundColor = color + "22"; // Linie: transparenter Hintergrund
      }
    }
    if (!ds.borderColor && ["line", "radar"].includes(config.type)) {
      ds.borderColor = color;
      ds.borderWidth = ds.borderWidth ?? 2;
      ds.pointRadius = ds.pointRadius ?? 4;
      ds.tension = ds.tension ?? 0.3;
    }
  }

  // Globale Schrift + Stil
  if (!config.options) config.options = {};
  if (!config.options.plugins) config.options.plugins = {};
  if (!config.options.plugins.legend) {
    config.options.plugins.legend = { labels: { font: { size: 13, family: "Inter, sans-serif" } } };
  }
  if (config.options.plugins.title) {
    config.options.plugins.title.font = { size: 15, weight: "bold", family: "Inter, sans-serif" };
  }
}

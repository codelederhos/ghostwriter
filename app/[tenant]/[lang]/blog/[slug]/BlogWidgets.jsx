"use client";

import { useEffect } from "react";

/**
 * Hydrates interactive elements in dangerouslySetInnerHTML blog content:
 * - [data-widget="stat"] → animated counter (0 → value)
 * - .gw-chart → interactive Chart.js chart
 * - .sources-list → smooth scroll anchor
 */
export default function BlogWidgets() {
  useEffect(() => {
    // Chart.js: load from CDN and render all .gw-chart containers
    const charts = document.querySelectorAll(".gw-chart");
    if (charts.length > 0) {
      const existing = document.querySelector('script[data-chartjs]');
      const init = () => {
        charts.forEach(el => {
          const cfg = el.querySelector(".gw-chart-config");
          if (!cfg || el.querySelector("canvas")) return;
          try {
            const config = JSON.parse(cfg.textContent);
            applyChartDefaults(config);
            const canvas = document.createElement("canvas");
            el.appendChild(canvas);
            // eslint-disable-next-line no-undef
            new Chart(canvas, config);
          } catch (e) {
            console.warn("[BlogWidgets] Chart init failed:", e);
          }
        });
      };
      if (existing || window.Chart) {
        init();
      } else {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";
        s.setAttribute("data-chartjs", "1");
        s.onload = init;
        document.head.appendChild(s);
      }
    }

    // Animate all stat widgets
    const widgets = document.querySelectorAll("[data-widget='stat']");
    widgets.forEach(el => {
      const target = parseFloat(el.dataset.value);
      const unit = el.dataset.unit || "";
      const label = el.dataset.label || "";
      if (isNaN(target)) return;

      // Wrap in styled card
      const card = document.createElement("span");
      card.className = "stat-widget";
      card.setAttribute("aria-label", `${target}${unit} – ${label}`);

      const numEl = document.createElement("span");
      numEl.className = "stat-widget__num";
      numEl.textContent = "0" + unit;

      const labelEl = document.createElement("span");
      labelEl.className = "stat-widget__label";
      labelEl.textContent = label;

      card.appendChild(numEl);
      if (label) card.appendChild(labelEl);
      el.replaceWith(card);

      // Count-up animation
      animateCounter(numEl, 0, target, unit, 1200);
    });

    // Smooth scroll for source pill links
    document.querySelectorAll("a[href^='#src-']").forEach(link => {
      link.addEventListener("click", e => {
        e.preventDefault();
        const id = link.getAttribute("href").slice(1);
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }, []);

  return null;
}

function applyChartDefaults(config) {
  const PALETTE = ["#4f46e5","#16a34a","#dc2626","#d97706","#0891b2","#7c3aed","#be185d"];
  const datasets = config?.data?.datasets || [];
  const isBar = ["bar","horizontalBar"].includes(config.type);
  const isLine = config.type === "line";
  datasets.forEach((ds, i) => {
    const c = PALETTE[i % PALETTE.length];
    if (!ds.backgroundColor) ds.backgroundColor = isLine ? c + "22" : isBar && datasets.length === 1 ? PALETTE.map(p => p + "cc") : c + "cc";
    if (!ds.borderColor && isLine) { ds.borderColor = c; ds.borderWidth = ds.borderWidth ?? 2; ds.tension = ds.tension ?? 0.35; }
  });
  if (!config.options) config.options = {};
  config.options.responsive = true;
  config.options.animation = { duration: 900, easing: "easeOutQuart" };
  if (!config.options.plugins) config.options.plugins = {};
  if (!config.options.plugins.legend) config.options.plugins.legend = { labels: { font: { size: 13 } } };
  if (config.options.plugins.title) config.options.plugins.title.font = { size: 15, weight: "bold" };
  if (!config.options.scales) return;
  Object.values(config.options.scales).forEach(ax => {
    if (!ax.grid) ax.grid = { color: "#e5e7eb" };
    if (!ax.ticks) ax.ticks = { font: { size: 12 }, color: "#6b7280" };
  });
}

function animateCounter(el, from, to, unit, durationMs) {
  const isFloat = !Number.isInteger(to);
  const decimals = isFloat ? String(to).split(".")[1]?.length || 1 : 0;
  const startTime = performance.now();

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = from + (to - from) * eased;
    el.textContent = current.toFixed(decimals) + unit;
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

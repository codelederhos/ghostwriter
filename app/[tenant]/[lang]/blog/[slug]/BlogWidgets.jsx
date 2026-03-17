"use client";

import { useEffect } from "react";

/**
 * Hydrates interactive elements in dangerouslySetInnerHTML blog content:
 * - [data-widget="stat"] → animated counter (0 → value)
 * - .sources-list → smooth scroll anchor
 */
export default function BlogWidgets() {
  useEffect(() => {
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

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reader-UX für Blog-Artikel (Preview UND Live-Blog):
 *  - Scroll-Reveal: direkte Kinder des .blog-prose blenden gestaffelt ein
 *  - Floating TOC-Button unten rechts mit SVG-Progress-Ring (Lesefortschritt),
 *    Panel mit Inhaltsverzeichnis (h2-Anker, aktives Kapitel) und
 *    dynamischer Rest-Lesedauer ("noch ~4 Min.", Wörter/200)
 *  - staticMode (?static=1): keine Animationen, Counter sofort auf Endwert
 *    (window.__GW_STATIC + html[data-gw-static] für BlogWidgets/CSS) — für Screenshots
 *
 * CSS: globals.css unter Kommentar "Reader Experience".
 * h2-Anker-IDs injiziert die Server-Seite (lib/blog/heading-ids.js).
 *
 * @param {"preview"|"live"} mode   nur informativ (kein DraftActions-Rendering hier)
 * @param {boolean} staticMode      Screenshot-Modus ohne Animationen
 * @param {boolean} raised          TOC-Button höher setzen (Platz für DraftActions-Buttons)
 */

const WORDS_PER_MINUTE = 200;
const REVEAL_SELECTOR = "h2, p, div, ul, ol, table, figure, blockquote, aside";
const RING_RADIUS = 25;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function ReaderExperience({ mode = "live", staticMode = false, raised = false }) {
  const [open, setOpen] = useState(false);
  const [tocItems, setTocItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [remainingMin, setRemainingMin] = useState(null);
  const totalMinutesRef = useRef(0);
  const rafRef = useRef(0);

  // Static-Flag SOFORT global setzen, damit BlogWidgets + CSS es sehen.
  // (Zusätzlich bekommen BlogWidgets staticMode als Prop von der Server-Seite.)
  useEffect(() => {
    if (!staticMode) return;
    window.__GW_STATIC = true;
    document.documentElement.setAttribute("data-gw-static", "1");
    return () => {
      delete window.__GW_STATIC;
      document.documentElement.removeAttribute("data-gw-static");
    };
  }, [staticMode]);

  // TOC-Einträge + Gesamtlesezeit einsammeln
  useEffect(() => {
    const prose = document.querySelector(".blog-prose");
    if (!prose) return;

    const words = (prose.textContent || "").split(/\s+/).filter(Boolean).length;
    totalMinutesRef.current = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
    setRemainingMin(totalMinutesRef.current);

    const items = Array.from(prose.querySelectorAll("h2[id]")).map((h2) => ({
      id: h2.id,
      text: (h2.textContent || "").replace(/\s+/g, " ").trim(),
    }));
    setTocItems(items);
  }, []);

  // Scroll-Reveal (nur ohne staticMode und ohne prefers-reduced-motion)
  useEffect(() => {
    if (staticMode || prefersReducedMotion()) return;
    const prose = document.querySelector(".blog-prose");
    if (!prose || typeof IntersectionObserver === "undefined") return;

    const targets = Array.from(prose.children).filter((el) => el.matches(REVEAL_SELECTOR));
    targets.forEach((el) => el.classList.add("gw-reveal"));

    const io = new IntersectionObserver(
      (entries) => {
        // Stagger ~80ms innerhalb eines Batches gleichzeitig sichtbarer Elemente
        let batchIndex = 0;
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          el.style.transitionDelay = `${batchIndex * 80}ms`;
          el.classList.add("gw-reveal-in");
          batchIndex += 1;
          io.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
    );
    targets.forEach((el) => io.observe(el));

    return () => {
      io.disconnect();
      targets.forEach((el) => {
        el.classList.remove("gw-reveal", "gw-reveal-in");
        el.style.transitionDelay = "";
      });
    };
  }, [staticMode]);

  // Lesefortschritt + aktives Kapitel + Rest-Lesedauer (rAF-gedrosselt)
  const updateProgress = useCallback(() => {
    const prose = document.querySelector(".blog-prose");
    if (!prose) return;

    const rect = prose.getBoundingClientRect();
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const start = scrollY + rect.top;
    const end = start + prose.offsetHeight - window.innerHeight;
    const p = end > start
      ? Math.min(1, Math.max(0, (scrollY - start) / (end - start)))
      : 1;
    setProgress(p);
    setRemainingMin(Math.ceil(totalMinutesRef.current * (1 - p)));

    // Aktives Kapitel: letztes h2 oberhalb der Lese-Linie
    const headings = Array.from(prose.querySelectorAll("h2[id]"));
    let current = null;
    for (const h2 of headings) {
      if (h2.getBoundingClientRect().top <= 120) current = h2.id;
      else break;
    }
    setActiveId(current);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        updateProgress();
      });
    };
    updateProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [updateProgress]);

  // Escape schließt das Panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const jumpTo = useCallback((e, id) => {
    e.preventDefault();
    const target = document.getElementById(id);
    if (target) {
      const smooth = !staticMode && !prefersReducedMotion();
      target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
    setOpen(false);
  }, [staticMode]);

  const restLabel = remainingMin == null
    ? ""
    : remainingMin <= 0
      ? "fertig gelesen"
      : `noch ~${remainingMin} Min.`;

  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <>
      {/* Floating TOC-Button mit Progress-Ring */}
      <button
        type="button"
        className={`gw-toc-fab${raised ? " gw-toc-fab--raised" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Inhaltsverzeichnis schließen" : "Inhaltsverzeichnis öffnen"}
        aria-expanded={open}
        title="Inhaltsverzeichnis"
      >
        <svg className="gw-toc-fab__ring" viewBox="0 0 56 56" aria-hidden="true">
          <circle className="gw-toc-fab__ring-track" cx="28" cy="28" r={RING_RADIUS} />
          <circle
            className="gw-toc-fab__ring-progress"
            cx="28"
            cy="28"
            r={RING_RADIUS}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <svg className="gw-toc-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="14" y2="12" />
          <line x1="4" y1="17" x2="17" y2="17" />
        </svg>
      </button>

      {/* Backdrop (mobil abgedunkelt, Desktop transparent — Klick schließt) */}
      {open && (
        <div className="gw-toc-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      {/* Panel: Desktop-Popover / mobil Bottom-Sheet */}
      {open && (
        <div
          className={`gw-toc-panel${raised ? " gw-toc-panel--raised" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Inhaltsverzeichnis"
        >
          <div className="gw-toc-panel__head">
            <span className="gw-toc-panel__title">Inhalt</span>
            {restLabel && <span className="badge badge-neutral">{restLabel}</span>}
            <button
              type="button"
              className="gw-toc-panel__close"
              onClick={() => setOpen(false)}
              aria-label="Schließen"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          {tocItems.length > 0 ? (
            <nav className="gw-toc-panel__list">
              {tocItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={(e) => jumpTo(e, item.id)}
                  className={`gw-toc-panel__item${activeId === item.id ? " gw-toc-panel__item--active" : ""}`}
                  aria-current={activeId === item.id ? "true" : undefined}
                >
                  {item.text}
                </a>
              ))}
            </nav>
          ) : (
            <p className="gw-toc-panel__empty">Keine Kapitel gefunden.</p>
          )}
        </div>
      )}
    </>
  );
}

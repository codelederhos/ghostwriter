/**
 * Format milliseconds as "Xs" or "M:SS min"
 * @param {number} ms
 * @returns {string}
 */
export function fmtMs(ms) {
  if (!ms) return "";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")} min` : `${s}s`;
}

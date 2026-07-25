const IMAGE_STYLE = [
  "display:block",
  "width:100%",
  "max-width:100%",
  "height:auto",
  "object-fit:cover",
].join(";");

const CHART_STYLE = [
  "display:block",
  "width:100%",
  "max-width:100%",
  "height:auto",
  "object-fit:contain",
].join(";");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function withAttribute(tag, name, value) {
  const attr = new RegExp(`\\s${name}=(["'])[^"']*\\1`, "i");
  if (attr.test(tag)) {
    return tag.replace(attr, ` ${name}="${escapeHtml(value)}"`);
  }
  return tag.replace(/>$/, ` ${name}="${escapeHtml(value)}">`);
}

function withClass(tag, className) {
  const match = tag.match(/\sclass=(["'])([^"']*)\1/i);
  if (!match) return tag.replace(/>$/, ` class="${className}">`);
  const classes = new Set(match[2].split(/\s+/).filter(Boolean));
  classes.add(className);
  return tag.replace(match[0], ` class="${[...classes].join(" ")}"`);
}

function withStyle(tag, contractStyle) {
  const match = tag.match(/\sstyle=(["'])([^"']*)\1/i);
  const current = match?.[2]?.trim().replace(/;+$/, "") || "";
  const style = current ? `${current};${contractStyle}` : contractStyle;
  if (match) return tag.replace(match[0], ` style="${style}"`);
  return tag.replace(/>$/, ` style="${style}">`);
}

function normalizeImgTag(tag, kind) {
  let result = withClass(tag, "gw-responsive-media");
  result = withAttribute(result, "loading", "lazy");
  result = withAttribute(result, "decoding", "async");
  result = withStyle(result, kind === "chart" ? CHART_STYLE : IMAGE_STYLE);
  return result;
}

export function buildArticleImageHtml({ src, alt, width = 1600, height = 900 }) {
  return [
    '<figure class="article-figure gw-media">',
    `<img class="gw-responsive-media" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"`,
    ` width="${width}" height="${height}" loading="lazy" decoding="async"`,
    ` style="${IMAGE_STYLE}" />`,
    "</figure>",
  ].join("");
}

/**
 * Erzwingt den Medienvertrag auch für ältere oder extern bearbeitete Artikel.
 * Der Inline-Vertrag ist absichtlich redundant zum Mandanten-CSS, damit ein
 * fehlendes `height:auto` auf einer Zielseite keine Bilder mehr streckt.
 */
export function normalizePublishedMediaHtml(html) {
  if (!html) return html;
  let normalized = String(html);

  normalized = normalized.replace(
    /(<figure\b[^>]*\barticle-figure\b[^>]*>)([\s\S]*?)(<img\b[^>]*>)([\s\S]*?<\/figure>)/gi,
    (_match, figure, before, img, after) => {
      const normalizedFigure = withClass(figure, "gw-media");
      return `${normalizedFigure}${before}${normalizeImgTag(img, "image")}${after}`;
    }
  );

  normalized = normalized.replace(
    /(<(?:div|figure)\b[^>]*\bgw-chart\b[^>]*>)([\s\S]*?)(<img\b[^>]*>)([\s\S]*?<\/(?:div|figure)>)/gi,
    (_match, chart, before, img, after) =>
      `${chart}${before}${normalizeImgTag(img, "chart")}${after}`
  );

  return normalized;
}

export const MEDIA_CONTRACT = {
  imageStyle: IMAGE_STYLE,
  chartStyle: CHART_STYLE,
};

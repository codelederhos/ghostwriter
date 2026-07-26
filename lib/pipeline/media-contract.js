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

function attributePattern(name) {
  return new RegExp(
    `(?:^|\\s)${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\\x60]+))?`,
    "i"
  );
}

function attributeValue(tag, name) {
  const match = tag.match(new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    "i"
  ));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function insertAttribute(tag, attribute) {
  return tag.replace(/\s*\/?>$/, (ending) => ` ${attribute}${ending}`);
}

function withAttribute(tag, name, value) {
  const attr = attributePattern(name);
  const replacement = ` ${name}="${escapeHtml(value)}"`;
  return attr.test(tag) ? tag.replace(attr, replacement) : insertAttribute(tag, replacement.trimStart());
}

function classNames(tag) {
  return String(attributeValue(tag, "class") || "").split(/\s+/).filter(Boolean);
}

function withClass(tag, className) {
  const classes = new Set(classNames(tag));
  classes.add(className);
  return withAttribute(tag, "class", [...classes].join(" "));
}

function parseStyle(value) {
  const declarations = [];
  const positions = new Map();
  for (const raw of String(value || "").split(";")) {
    const idx = raw.indexOf(":");
    if (idx < 1) continue;
    const property = raw.slice(0, idx).trim().toLowerCase();
    const declaration = `${property}:${raw.slice(idx + 1).trim()}`;
    if (!property) continue;
    if (positions.has(property)) declarations[positions.get(property)] = declaration;
    else {
      positions.set(property, declarations.length);
      declarations.push(declaration);
    }
  }
  return { declarations, positions };
}

function withStyle(tag, contractStyle) {
  const current = parseStyle(attributeValue(tag, "style"));
  for (const declaration of contractStyle.split(";")) {
    const idx = declaration.indexOf(":");
    const property = declaration.slice(0, idx).trim().toLowerCase();
    const normalized = `${property}:${declaration.slice(idx + 1).trim()}`;
    if (current.positions.has(property)) {
      current.declarations[current.positions.get(property)] = normalized;
    } else {
      current.positions.set(property, current.declarations.length);
      current.declarations.push(normalized);
    }
  }
  return withAttribute(tag, "style", current.declarations.join(";"));
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

function nextTag(html, start) {
  const opening = html.indexOf("<", start);
  if (opening < 0) return null;
  let quote = null;
  for (let i = opening + 1; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return { start: opening, end: i + 1, value: html.slice(opening, i + 1) };
    }
  }
  return null;
}

/**
 * Erzwingt den Medienvertrag auch für ältere oder extern bearbeitete Artikel.
 * Der kleine Tokenizer respektiert Quotes, verschachtelte Wrapper und unquoted
 * Attribute. Er verändert ausschließlich Bilder in article-figure/gw-chart.
 */
export function normalizePublishedMediaHtml(html) {
  if (!html) return html;
  const input = String(html);
  const stack = [];
  const pieces = [];
  let cursor = 0;
  let token;

  while ((token = nextTag(input, cursor))) {
    pieces.push(input.slice(cursor, token.start));
    let tag = token.value;
    const closing = tag.match(/^<\s*\/\s*([a-z0-9:-]+)/i);
    const opening = tag.match(/^<\s*([a-z0-9:-]+)/i);

    if (closing) {
      const name = closing[1].toLowerCase();
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const entry = stack.pop();
        if (entry.name === name) break;
      }
    } else if (opening && !/^<\s*[!?]/.test(tag)) {
      const name = opening[1].toLowerCase();
      const classes = classNames(tag);
      const ownKind = classes.includes("gw-chart")
        ? "chart"
        : classes.includes("article-figure")
          ? "image"
          : null;
      const inheritedKind = [...stack].reverse().find((entry) => entry.kind)?.kind || null;
      const kind = ownKind || inheritedKind;

      if (ownKind === "image") tag = withClass(tag, "gw-media");
      if (name === "img" && kind) tag = normalizeImgTag(tag, kind);

      const isVoid = /\/\s*>$/.test(tag)
        || ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(name);
      if (!isVoid) stack.push({ name, kind });
    }

    pieces.push(tag);
    cursor = token.end;
  }
  pieces.push(input.slice(cursor));
  return pieces.join("");
}

export const MEDIA_CONTRACT = {
  imageStyle: IMAGE_STYLE,
  chartStyle: CHART_STYLE,
};

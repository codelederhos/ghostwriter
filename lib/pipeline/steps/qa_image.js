import sharp from "sharp";
import { callClaudeVision } from "../vision.js";

const IMAGE_PROMPT = `Du bist Bildredakteur für einen hochwertigen Unternehmensblog.
Bewerte beide Bilder gemeinsam und einzeln.

Prüfe streng:
1. konkrete Relevanz zum Artikeltitel und Keyword, nicht nur ungefähr passende Business-Stimmung
2. glaubwürdige redaktionelle Fotografie statt generischem KI-Stock
3. keine Neon-Hacker-Klischees, schwebenden HUDs, leuchtenden Gehirne, goldenen Schlösser oder austauschbaren hellen Büros
4. keine anatomischen Fehler, Doppelobjekte, unlogische Perspektiven oder künstliche Haut
5. keine lesbaren Fantasietexte, kaputten UI-Elemente oder sinnlosen Dokumente
6. Bild 1 und Bild 2 müssen unterschiedliche, zusammenpassende Szenen sein
7. beide Motive müssen als breite Artikelbilder funktionieren

Antworte ausschließlich mit gültigem JSON:
{
  "ok": true,
  "score": 0,
  "issues": [
    {
      "image": 1,
      "severity": "low|medium|high",
      "criterion": "relevance|cliche|artifact|fake_text|diversity|format",
      "description": "konkret und kurz"
    }
  ],
  "summary": "ein Satz"
}

ok darf nur true sein, wenn score mindestens 80 ist und kein high-Problem besteht.`;

async function loadImage(url) {
  const absoluteUrl = new URL(url, process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").toString();
  const response = await fetch(absoluteUrl, {
    headers: { Accept: "image/avif,image/webp,image/png,image/jpeg" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`image ${response.status}`);
  const input = Buffer.from(await response.arrayBuffer());
  return sharp(input)
    .rotate()
    .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 84 })
    .toBuffer();
}

export async function runImageQualityGate({ imageResult, article, seo }) {
  const urls = [imageResult?.url, imageResult?.url2].filter(Boolean);
  if (urls.length < 2) {
    return {
      ok: false,
      score: 0,
      issues: [{ image: urls.length + 1, severity: "high", criterion: "format", description: "Zweites Artikelbild fehlt." }],
      summary: "Der Bildsatz ist unvollständig.",
      checked_at: new Date().toISOString(),
    };
  }

  try {
    const buffers = await Promise.all(urls.map(loadImage));
    const contextPrompt = [
      IMAGE_PROMPT,
      `Artikeltitel: ${article?.title || ""}`,
      `Keyword: ${seo?.primaryKeyword || ""}`,
      `Bildidee 1: ${article?.image_prompt_1 || ""}`,
      `Bildidee 2: ${article?.image_prompt_2 || ""}`,
    ].join("\n");
    const { result, model } = await callClaudeVision({
      images: buffers.map((buffer, index) => ({
        label: `Artikelbild ${index + 1}`,
        buffer,
        mediaType: "image/jpeg",
      })),
      prompt: contextPrompt,
    });
    const score = Number(result?.score) || 0;
    const issues = Array.isArray(result?.issues) ? result.issues : [];
    const hasHigh = issues.some((issue) => issue?.severity === "high");
    return {
      ...result,
      ok: result?.ok === true && score >= 80 && !hasHigh,
      score,
      issues,
      model,
      checked_at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      score: 0,
      issues: [{ image: 0, severity: "high", criterion: "artifact", description: `Bild-QA nicht ausführbar: ${error.message}` }],
      summary: "Die Bildqualität konnte nicht verifiziert werden.",
      error: error.message,
      checked_at: new Date().toISOString(),
    };
  }
}

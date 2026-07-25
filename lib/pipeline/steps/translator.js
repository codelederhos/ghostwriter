/**
 * Step 3t: TRANSLATOR
 * Übersetzt einen vorhandenen DE-Artikel (Title/Slug/Meta/Body) in die Zielsprache.
 * Läuft auf Haiku (kostengeneigt, genügt für reine Übersetzung).
 */

import { generateText } from '../../providers/text.js';
import { jsonrepair } from 'jsonrepair';

const LANG_NAMES = {
  de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español',
  it: 'Italiano', nl: 'Nederlands', pt: 'Português',
};

function slugify(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function runTranslator(settings, sourceArticle, sourceLanguage, targetLanguage) {
  const langName = LANG_NAMES[targetLanguage] || targetLanguage;
  const srcLangName = LANG_NAMES[sourceLanguage] || sourceLanguage;

  const systemPrompt = 'Du bist ein professioneller SEO-Übersetzer. ' +
    'Du übersetzt Blog-Artikel inhaltsgetreu in die Zielsprache. ' +
    'HTML-Struktur, Klassen, IDs und Tags bleiben 100% erhalten. ' +
    'Idiomatisch natürlich, nicht wörtlich. Keine Floskeln, kein KI-Sprech.';

  const userPrompt =
    'Quellsprache: ' + srcLangName + '\n' +
    'Zielsprache: ' + langName + '\n\n' +
    'Aufgabe: Übersetze den folgenden Artikel idiomatisch und SEO-bewusst.\n\n' +
    'INPUT (JSON):\n' + JSON.stringify({
      title: sourceArticle.title,
      title_tag: sourceArticle.title_tag,
      meta_description: sourceArticle.meta_description,
      body_html: sourceArticle.body_html,
      gbp_text: sourceArticle.gbp_text,
    }) + '\n\n' +
    'OUTPUT als JSON mit den Feldern { title, title_tag, meta_description, slug, body_html, gbp_text }. ' +
    'slug ist eine ASCII-Kebab-Variante des übersetzten Titels. ' +
    'body_html: alle HTML-Tags exakt aus dem Original übernehmen, nur Text-Knoten übersetzen. ' +
    'Keine erfundenen Inhalte, keine zusätzlichen Abschnitte. ' +
    'WICHTIG: NUR das reine JSON ausgeben, kein Markdown-Fence, kein Vor-/Nachtext.';

  // Für Übersetzung: Modell-Override auf Haiku via clone-Settings
  // _model_override, weil text_model vom Recommended-Modell überstimmt wird
  const settingsHaiku = { ...settings, _model_override: 'claude-haiku-4-5' };
  const raw = await generateText(settingsHaiku, systemPrompt, userPrompt);

  let parsed;
  try {
    const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    parsed = JSON.parse(clean);
  } catch {
    try { parsed = JSON.parse(jsonrepair(raw)); } catch (e) {
      throw new Error('Translator JSON parse: ' + e.message);
    }
  }

  if (!parsed.slug || !parsed.slug.match(/^[a-z0-9-]+$/)) {
    parsed.slug = slugify(parsed.title || sourceArticle.slug + '-' + targetLanguage);
  }

  return parsed;
}

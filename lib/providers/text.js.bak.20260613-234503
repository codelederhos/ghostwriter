/**
 * Text Provider Interface
 * Supports: Anthropic Claude, OpenAI GPT, Mistral, Custom endpoint
 *
 * Modell-Auswahl ist AUTONOM — Kunden wählen nur Provider + API Key.
 * Modelle werden über Admin Settings (system_config) gepflegt.
 */
import { query } from "../db.js";

// Fallback falls DB nicht erreichbar
const FALLBACK_MODELS = {
  anthropic: "claude-sonnet-4-20250514",
  openai:    "gpt-4.1-mini",
  mistral:   "mistral-large-latest",
};

let _cachedModels = null;
let _cacheTime = 0;

async function getRecommendedModel(provider) {
  // Cache für 5 Minuten
  if (_cachedModels && Date.now() - _cacheTime < 300000) {
    return _cachedModels[provider]?.model || FALLBACK_MODELS[provider];
  }
  try {
    const { rows } = await query("SELECT value FROM system_config WHERE key = 'recommended_models'");
    if (rows.length > 0) {
      _cachedModels = rows[0].value;
      _cacheTime = Date.now();
      return _cachedModels[provider]?.model || FALLBACK_MODELS[provider];
    }
  } catch { /* DB not ready */ }
  return FALLBACK_MODELS[provider];
}

async function callAnthropic(apiKey, model, systemPrompt, userPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

async function callOpenAI(apiKey, model, systemPrompt, userPrompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callMistral(apiKey, model, systemPrompt, userPrompt) {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "mistral-large-latest",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callCustom(endpoint, apiKey, model, systemPrompt, userPrompt) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Custom LLM ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || data.content?.[0]?.text || JSON.stringify(data);
}

/**
 * Generate text using the tenant's configured provider
 * @param {object} settings - Decrypted tenant settings
 * @param {string} systemPrompt - System instruction
 * @param {string} userPrompt - User message
 * @returns {string} Generated text
 */
export async function generateText(settings, systemPrompt, userPrompt) {
  const provider = settings.text_provider || "anthropic";
  const apiKey = settings.text_api_key || process.env.ANTHROPIC_API_KEY;
  const model = await getRecommendedModel(provider) || settings.text_model;

  switch (provider) {
    case "anthropic":
      return callAnthropic(apiKey, model, systemPrompt, userPrompt);
    case "openai":
      return callOpenAI(apiKey || process.env.OPENAI_API_KEY, model, systemPrompt, userPrompt);
    case "mistral":
      return callMistral(apiKey, model, systemPrompt, userPrompt);
    case "custom":
      return callCustom(settings.text_custom_endpoint, apiKey, model, systemPrompt, userPrompt);
    default:
      throw new Error(`Unknown text provider: ${provider}`);
  }
}

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
  anthropic: "claude-sonnet-4-6",
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

const HAIKU_FALLBACK_MODEL = 'claude-haiku-4-5';

async function _anthropicFetch(apiKey, model, systemPrompt, userPrompt) {
  const isOAuth = apiKey && apiKey.startsWith('sk-ant-oat');
  const headers = { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (isOAuth) {
    headers['Authorization'] = 'Bearer ' + apiKey;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else {
    headers['x-api-key'] = apiKey;
  }
  const sysPrompt = isOAuth
    ? 'You are Claude Code, Anthropics official CLI for Claude.\n\n' + systemPrompt
    : systemPrompt;
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system: sysPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
}

async function callAnthropic(apiKey, model, systemPrompt, userPrompt) {
  const primary = model || 'claude-sonnet-4-6';
  let res = await _anthropicFetch(apiKey, primary, systemPrompt, userPrompt);
  if (!res.ok && (res.status === 429 || res.status === 529) && primary !== HAIKU_FALLBACK_MODEL) {
    console.warn('[Anthropic] ' + res.status + ' bei ' + primary + ', Fallback auf ' + HAIKU_FALLBACK_MODEL);
    res = await _anthropicFetch(apiKey, HAIKU_FALLBACK_MODEL, systemPrompt, userPrompt);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Anthropic ' + res.status + ': ' + err);
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
      max_tokens: 8192,
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
      max_tokens: 8192,
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
      max_tokens: 8192,
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
  const apiKey = settings.text_api_key || process.env.CLAUDE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
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

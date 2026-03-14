/**
 * Text Provider Interface
 * Supports: Anthropic Claude, OpenAI GPT, Mistral, Custom endpoint
 */

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
  const model = settings.text_model;

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

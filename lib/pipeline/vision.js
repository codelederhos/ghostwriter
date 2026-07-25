const DEFAULT_MODEL = process.env.QA_VISION_MODEL || "claude-haiku-4-5";
const FALLBACK_MODEL = "claude-haiku-4-5";

function extractJson(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no json in vision response");
  return JSON.parse(match[0]);
}

export async function callClaudeVision({ images, prompt, maxTokens = 1400, model = DEFAULT_MODEL }) {
  const oauth = process.env.CLAUDE_OAUTH_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!oauth && !apiKey) throw new Error("CLAUDE_OAUTH_TOKEN or ANTHROPIC_API_KEY required");
  if (!Array.isArray(images) || images.length === 0) throw new Error("at least one image required");

  const headers = {
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  if (oauth) {
    headers.Authorization = `Bearer ${oauth}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = apiKey;
  }

  const content = [];
  for (const [index, image] of images.entries()) {
    content.push({
      type: "text",
      text: image.label || `Bild ${index + 1}`,
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType || "image/png",
        data: image.buffer.toString("base64"),
      },
    });
  }
  content.push({ type: "text", text: prompt });

  const buildBody = (modelName) => JSON.stringify({
    model: modelName,
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
  });

  let activeModel = model;
  let response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: buildBody(activeModel),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok && [429, 529].includes(response.status) && activeModel !== FALLBACK_MODEL) {
    activeModel = FALLBACK_MODEL;
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: buildBody(activeModel),
      signal: AbortSignal.timeout(45000),
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`anthropic ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = (data?.content || [])
    .filter((entry) => entry?.type === "text")
    .map((entry) => entry.text)
    .join("\n");
  return { result: extractJson(text), model: activeModel };
}

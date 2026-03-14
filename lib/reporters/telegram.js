/**
 * Telegram Reporter
 * Sends post reports and error alerts to configured Telegram chat
 */

export async function sendTelegramReport(botToken, chatId, report) {
  const lines = [
    `📝 *Neuer Ghostwriter Post*`,
    ``,
    `*${escapeMarkdown(report.title)}*`,
    `🌐 Sprache: ${report.language.toUpperCase()}`,
    `📂 Kategorie: ${escapeMarkdown(report.category || "")}`,
    `🎯 Angle: ${report.angle || ""}`,
    `🔑 Keyword: ${escapeMarkdown(report.keyword || "")}`,
    ``,
    `📰 Blog: ${report.blogUrl}`,
    report.gbpPostId ? `📍 GBP: Gepostet` : `📍 GBP: Übersprungen`,
    ``,
    `GBP-Text (${(report.gbpText || "").length} Zeichen):`,
    `_${escapeMarkdown((report.gbpText || "").slice(0, 200))}_`,
  ];

  const text = lines.join("\n");

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram ${res.status}: ${err}`);
  }
}

export async function sendTelegramAlert(botToken, chatId, tenantName, error) {
  const text = `⚠️ *Ghostwriter Fehler*\n\nTenant: ${escapeMarkdown(tenantName)}\nFehler: ${escapeMarkdown(error)}`;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

function escapeMarkdown(text) {
  return (text || "").replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

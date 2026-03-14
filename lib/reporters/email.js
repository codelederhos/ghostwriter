/**
 * Email Reporter
 * Sends post reports via SMTP
 */

import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

export async function sendEmailReport(to, report) {
  const t = getTransporter();
  if (!t) {
    console.warn("[Email] SMTP not configured, skipping report");
    return;
  }

  const subject = `Ghostwriter: "${report.title}" (${report.language.toUpperCase()})`;

  const html = `
    <h2>Neuer Ghostwriter Post</h2>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Tenant</td><td>${report.tenantName}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Titel</td><td>${report.title}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Sprache</td><td>${report.language.toUpperCase()}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Kategorie</td><td>${report.category || "-"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Angle</td><td>${report.angle || "-"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Keyword</td><td>${report.keyword || "-"}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Blog</td><td><a href="${report.blogUrl}">${report.blogUrl}</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">GBP</td><td>${report.gbpPostId ? "Gepostet" : "Übersprungen"}</td></tr>
    </table>
    <h3>GBP-Text (${(report.gbpText || "").length} Zeichen)</h3>
    <p style="background:#f5f5f5;padding:12px;border-radius:6px;font-style:italic">${report.gbpText || "-"}</p>
    <hr>
    <p style="font-size:11px;color:#999">Ghostwriter by Code Lederhos</p>
  `;

  await t.sendMail({
    from: process.env.SMTP_FROM || "ghostwriter@code-lederhos.de",
    to,
    subject,
    html,
  });
}

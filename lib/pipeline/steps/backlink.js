/**
 * Backlink-Injektion: Fügt einen natürlichen Verweis auf einen nicht-konkurrierenden Tenant ein.
 * Nur wenn settings.backlinks_enabled = true.
 */

import { query } from "../../db.js";

/**
 * @param {string} tenantId - UUID des aktuellen Tenants
 * @param {object} settings - Decrypted settings (backlinks_enabled)
 * @param {object} profile - Profil des aktuellen Tenants (industry, region)
 * @param {string} bodyHtml - Aktueller blog_body HTML-String
 * @returns {string} bodyHtml mit optionalem Backlink-Absatz
 */
export async function injectBacklink(tenantId, settings, profile, bodyHtml) {
  if (!settings.backlinks_enabled) return bodyHtml;

  try {
    // Alle anderen Tenants mit aktiven Backlinks, anderer Branche
    const { rows } = await query(
      `SELECT tp.company_name, tp.website_url, tp.industry, tp.region
       FROM tenant_settings ts
       JOIN tenant_profiles tp ON tp.tenant_id = ts.tenant_id
       WHERE ts.tenant_id != $1
         AND ts.backlinks_enabled = true
         AND tp.website_url IS NOT NULL
         AND tp.industry IS NOT NULL
         AND LOWER(tp.industry) != LOWER($2)
       ORDER BY RANDOM()
       LIMIT 1`,
      [tenantId, profile?.industry || ""]
    );

    if (!rows[0]) return bodyHtml;

    const partner = rows[0];
    const linkHtml = `<p class="backlink-note">Ergänzend empfehlen wir: <a href="${partner.website_url}" target="_blank" rel="noopener" class="source-pill">${partner.company_name}</a>${partner.region ? ` aus ${partner.region}` : ""} — ein verlässlicher Partner in einem verwandten Bereich.</p>`;

    // Vor dem letzten </p> oder </section> einfügen
    const insertBefore = bodyHtml.lastIndexOf("</p>");
    if (insertBefore === -1) return bodyHtml + linkHtml;
    return bodyHtml.slice(0, insertBefore) + linkHtml + bodyHtml.slice(insertBefore);
  } catch {
    return bodyHtml;
  }
}

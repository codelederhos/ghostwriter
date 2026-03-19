/**
 * JS-Embed Snippet für Client-Websites
 * GET /api/public/[tenant]/embed.js?lang=de&limit=5&style=cards
 *
 * Verwendung auf beliebiger Website:
 *   <div id="gw-blog"></div>
 *   <script src="https://ghostwriter.code-lederhos.de/api/public/baur-immobilien/embed.js?lang=de&limit=5"></script>
 *
 * Das Script rendert automatisch eine Blog-Post-Übersicht im #gw-blog Container.
 */
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { tenant } = params;
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") || "de";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "5"), 20);
  const style = url.searchParams.get("style") || "cards"; // cards | list | minimal
  const containerId = url.searchParams.get("container") || "gw-blog";

  const { rows: [t] } = await query(
    "SELECT id, name, slug FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenant]
  ).catch(() => ({ rows: [] }));

  const apiBase = process.env.NEXT_PUBLIC_BASE_URL || "";
  const apiUrl = `${apiBase}/api/public/${tenant}/${lang}/posts?limit=${limit}`;
  const tenantName = t?.name || tenant;

  const cardsCss = style === "cards" ? `
    .gw-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:1.25rem; }
    .gw-card { border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; background:#fff; transition:box-shadow .2s; }
    .gw-card:hover { box-shadow:0 4px 20px rgba(0,0,0,.08); }
    .gw-card-img { width:100%; aspect-ratio:16/9; object-fit:cover; display:block; background:#f3f4f6; }
    .gw-card-body { padding:.875rem 1rem 1rem; }
    .gw-card-meta { font-size:.75rem; color:#9ca3af; margin-bottom:.35rem; }
    .gw-card-title { font-size:1rem; font-weight:700; color:#111827; margin:0 0 .5rem; line-height:1.3; }
    .gw-card-desc { font-size:.85rem; color:#6b7280; margin:0 0 .75rem; line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .gw-card-link { font-size:.8rem; color:#4f46e5; text-decoration:none; font-weight:600; }
    .gw-footer { margin-top:1rem; text-align:right; font-size:.72rem; color:#d1d5db; }
    .gw-footer a { color:#d1d5db; text-decoration:none; }
  ` : style === "list" ? `
    .gw-list { list-style:none; padding:0; margin:0; }
    .gw-list-item { padding:.75rem 0; border-bottom:1px solid #f3f4f6; display:flex; gap:.875rem; align-items:flex-start; }
    .gw-list-item:last-child { border-bottom:none; }
    .gw-list-thumb { width:80px; height:60px; object-fit:cover; border-radius:6px; flex-shrink:0; background:#f3f4f6; }
    .gw-list-content { flex:1; min-width:0; }
    .gw-list-title { font-size:.95rem; font-weight:700; color:#111827; margin:0 0 .2rem; line-height:1.3; }
    .gw-list-meta { font-size:.75rem; color:#9ca3af; }
    .gw-list-title a { color:inherit; text-decoration:none; }
    .gw-list-title a:hover { text-decoration:underline; }
  ` : `
    .gw-minimal { list-style:none; padding:0; margin:0; }
    .gw-minimal li { padding:.4rem 0; border-bottom:1px solid #f3f4f6; }
    .gw-minimal li:last-child { border-bottom:none; }
    .gw-minimal a { color:#111827; text-decoration:none; font-size:.95rem; }
    .gw-minimal a:hover { text-decoration:underline; }
    .gw-minimal .gw-m-meta { font-size:.72rem; color:#9ca3af; margin-top:.15rem; }
  `;

  const renderFn = style === "cards" ? `
    function renderPosts(posts) {
      return '<div class="gw-grid">' + posts.map(p => {
        const date = p.published_at ? new Date(p.published_at).toLocaleDateString('${lang}', {year:'numeric',month:'short',day:'numeric'}) : '';
        const img = p.image_url ? '<img class="gw-card-img" src="' + esc(p.image_url) + '" alt="' + esc(p.image_alt_text || p.blog_title) + '" loading="lazy" width="640" height="360" />' : '<div class="gw-card-img"></div>';
        return '<div class="gw-card">' + img + '<div class="gw-card-body"><div class="gw-card-meta">' + esc(p.category || '') + (date ? ' · ' + date : '') + '</div><h3 class="gw-card-title">' + esc(p.blog_title) + '</h3><p class="gw-card-desc">' + esc(p.blog_meta_description || '') + '</p><a class="gw-card-link" href="' + esc(p.url) + '">Weiterlesen →</a></div></div>';
      }).join('') + '</div>';
    }` : style === "list" ? `
    function renderPosts(posts) {
      return '<ul class="gw-list">' + posts.map(p => {
        const date = p.published_at ? new Date(p.published_at).toLocaleDateString('${lang}', {year:'numeric',month:'short',day:'numeric'}) : '';
        const img = p.image_url ? '<img class="gw-list-thumb" src="' + esc(p.image_url) + '" alt="" loading="lazy" />' : '';
        return '<li class="gw-list-item">' + img + '<div class="gw-list-content"><div class="gw-list-title"><a href="' + esc(p.url) + '">' + esc(p.blog_title) + '</a></div><div class="gw-list-meta">' + esc(p.category || '') + (date ? ' · ' + date : '') + '</div></div></li>';
      }).join('') + '</ul>';
    }` : `
    function renderPosts(posts) {
      return '<ul class="gw-minimal">' + posts.map(p => {
        const date = p.published_at ? new Date(p.published_at).toLocaleDateString('${lang}', {year:'numeric',month:'short',day:'numeric'}) : '';
        return '<li><a href="' + esc(p.url) + '">' + esc(p.blog_title) + '</a><div class="gw-m-meta">' + (date || '') + '</div></li>';
      }).join('') + '</ul>';
    }`;

  const js = `(function() {
  var containerId = ${JSON.stringify(containerId)};
  var apiUrl = ${JSON.stringify(apiUrl)};
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  ${renderFn}
  function init() {
    var el = document.getElementById(containerId);
    if (!el) { el = document.createElement('div'); el.id = containerId; document.currentScript ? document.currentScript.parentNode.insertBefore(el, document.currentScript) : document.body.appendChild(el); }
    var style = document.createElement('style');
    style.textContent = ${JSON.stringify(cardsCss)};
    document.head.appendChild(style);
    el.innerHTML = '<p style="color:#9ca3af;font-size:.85rem">Lade Beiträge…</p>';
    fetch(apiUrl).then(function(r){return r.json();}).then(function(data){
      if (!data.posts || !data.posts.length) { el.innerHTML = ''; return; }
      el.innerHTML = renderPosts(data.posts) + '<div class="gw-footer">Blog powered by <a href="https://ghostwriter.code-lederhos.de" target="_blank">Ghostwriter</a></div>';
    }).catch(function(){ el.innerHTML = ''; });
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();`;

  return new Response(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

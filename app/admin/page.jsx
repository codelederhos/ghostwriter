import { query } from "@/lib/db";
import Link from "next/link";

export default async function AdminDashboard() {
  const { rows: [stats] } = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM tenants WHERE status = 'active') as tenants,
      (SELECT COUNT(*)::int FROM ghostwriter_posts WHERE status = 'published') as published,
      (SELECT COUNT(*)::int FROM ghostwriter_posts WHERE status = 'failed') as failed,
      (SELECT COUNT(*)::int FROM ghostwriter_posts WHERE created_at > NOW() - INTERVAL '7 days') as week_posts
  `);

  const { rows: recentPosts } = await query(`
    SELECT gp.*, t.name as tenant_name, t.slug as tenant_slug
    FROM ghostwriter_posts gp
    JOIN tenants t ON t.id = gp.tenant_id
    ORDER BY gp.created_at DESC
    LIMIT 10
  `);

  const { rows: tenants } = await query(`
    SELECT t.*, ts.next_run_at, ts.is_active as autopilot_active,
           (SELECT COUNT(*)::int FROM ghostwriter_posts WHERE tenant_id = t.id AND status = 'published') as post_count
    FROM tenants t
    LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
    WHERE t.status = 'active'
    ORDER BY ts.next_run_at ASC NULLS LAST
  `);

  return (
    <div>
      <h1 className="admin-title">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Tenants", value: stats.tenants, color: "text-blue-600" },
          { label: "Veröffentlicht", value: stats.published, color: "text-emerald-600" },
          { label: "Fehlgeschlagen", value: stats.failed, color: "text-red-600" },
          { label: "Diese Woche", value: stats.week_posts, color: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className="admin-card">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tenants Overview */}
      <div className="admin-card mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Tenants</h2>
          <Link href="/admin/tenants" className="btn-outline text-xs">Alle anzeigen</Link>
        </div>
        <div className="space-y-3">
          {tenants.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.post_count} Posts</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={t.autopilot_active ? "badge-success" : "badge-neutral"}>
                  {t.autopilot_active ? "Aktiv" : "Pausiert"}
                </span>
                {t.next_run_at && (
                  <span className="text-xs text-muted-foreground">
                    Nächster Run: {new Date(t.next_run_at).toLocaleString("de")}
                  </span>
                )}
              </div>
            </div>
          ))}
          {tenants.length === 0 && (
            <p className="text-muted-foreground text-sm">Noch keine Tenants. <Link href="/admin/tenants" className="text-primary underline">Jetzt erstellen</Link></p>
          )}
        </div>
      </div>

      {/* Recent Posts */}
      <div className="admin-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Letzte Posts</h2>
          <Link href="/admin/posts" className="btn-outline text-xs">Alle anzeigen</Link>
        </div>
        <div className="space-y-3">
          {recentPosts.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{p.blog_title || "Ohne Titel"}</p>
                <p className="text-xs text-muted-foreground">
                  {p.tenant_name} &middot; {p.language?.toUpperCase()} &middot; {p.category}
                </p>
              </div>
              <span className={
                p.status === "published" ? "badge-success" :
                p.status === "failed" ? "badge-error" :
                "badge-neutral"
              }>
                {p.status}
              </span>
            </div>
          ))}
          {recentPosts.length === 0 && (
            <p className="text-muted-foreground text-sm">Noch keine Posts generiert.</p>
          )}
        </div>
      </div>
    </div>
  );
}

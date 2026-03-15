"use client";

import { useState, useEffect } from "react";
import { FileText, TrendingUp, AlertCircle, Calendar } from "lucide-react";

export default function KundeDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch("/api/kunde").then(r => r.json()).then(setData);
  }, []);

  if (!data) return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-64 bg-muted rounded" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-border" />)}
      </div>
      <div className="h-64 bg-white rounded-xl border border-border" />
    </div>
  );

  const { tenant, settings, stats, posts } = data;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{tenant?.name}</h1>
          <p className="text-sm text-muted-foreground">{tenant?.domain}</p>
        </div>
        <span className={settings?.autopilot_active ? "badge-success" : "badge-neutral"}>
          {settings?.autopilot_active ? "Autopilot aktiv" : "Autopilot pausiert"}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Veröffentlicht", value: stats?.published || 0, icon: FileText, color: "text-emerald-600" },
          { label: "Gesamt", value: stats?.total || 0, icon: TrendingUp, color: "text-blue-600" },
          { label: "Fehlgeschlagen", value: stats?.failed || 0, icon: AlertCircle, color: "text-red-600" },
          { label: "Letzter Monat", value: stats?.month || 0, icon: Calendar, color: "text-amber-600" },
        ].map(s => (
          <div key={s.label} className="admin-card">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={14} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </div>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Autopilot Info */}
      {settings?.next_run_at && (
        <div className="admin-card mb-6 flex items-center gap-3">
          <Calendar size={16} className="text-muted-foreground" />
          <p className="text-sm">
            Nächster Post: <span className="font-medium">{new Date(settings.next_run_at).toLocaleString("de")}</span>
            <span className="text-muted-foreground ml-2">(alle {settings.frequency_hours}h)</span>
          </p>
        </div>
      )}

      {/* Posts */}
      <div className="admin-card">
        <h2 className="text-lg font-semibold mb-4">Veröffentlichte Artikel</h2>
        <div className="space-y-3">
          {posts?.length > 0 ? posts.map(p => (
            <div key={p.id} className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{p.blog_title || "Ohne Titel"}</p>
                <p className="text-xs text-muted-foreground">
                  {p.language?.toUpperCase()} &middot; {p.category} &middot; {p.created_at && new Date(p.created_at).toLocaleDateString("de")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={
                  p.status === "published" ? "badge-success" :
                  p.status === "failed" ? "badge-error" :
                  "badge-neutral"
                }>
                  {p.status === "published" ? "Live" : p.status === "failed" ? "Fehler" : p.status}
                </span>
                {p.status === "published" && p.blog_slug && (
                  <a
                    href={`/${tenant?.slug}/de/blog/${p.blog_slug}`}
                    target="_blank"
                    rel="noopener"
                    className="text-xs text-primary hover:underline"
                  >
                    Ansehen
                  </a>
                )}
              </div>
            </div>
          )) : (
            <p className="text-muted-foreground text-sm py-4 text-center">
              Noch keine Artikel. Sobald der Autopilot läuft, erscheinen hier die generierten Artikel.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

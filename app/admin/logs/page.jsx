"use client";

import { useState, useEffect } from "react";

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/logs")
      .then(r => r.json())
      .then(data => { setLogs(data.logs || []); setLoading(false); });
  }, []);

  return (
    <div>
      <h1 className="admin-title">Logs</h1>

      <div className="admin-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-3 font-medium text-muted-foreground">Zeitpunkt</th>
              <th className="pb-3 font-medium text-muted-foreground">Tenant</th>
              <th className="pb-3 font-medium text-muted-foreground">Schritt</th>
              <th className="pb-3 font-medium text-muted-foreground">Status</th>
              <th className="pb-3 font-medium text-muted-foreground">Nachricht</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3, 4, 5].map(i => (
                <tr key={i} className="border-b border-border/50 animate-pulse">
                  {[1, 2, 3, 4, 5].map(j => (
                    <td key={j} className="py-3"><div className="h-4 bg-muted rounded w-3/4" /></td>
                  ))}
                </tr>
              ))
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-muted-foreground">
                  Noch keine Logs. Sobald die Pipeline läuft, erscheinen hier die Ausführungsprotokolle.
                </td>
              </tr>
            ) : logs.map(l => (
              <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className="py-3 text-muted-foreground whitespace-nowrap">
                  {new Date(l.created_at).toLocaleString("de")}
                </td>
                <td className="py-3">{l.tenant_name}</td>
                <td className="py-3 text-muted-foreground">{l.step}</td>
                <td className="py-3">
                  <span className={
                    l.status === "success" ? "badge-success" :
                    l.status === "error" ? "badge-error" :
                    "badge-neutral"
                  }>
                    {l.status}
                  </span>
                </td>
                <td className="py-3 text-muted-foreground max-w-[400px] truncate">{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

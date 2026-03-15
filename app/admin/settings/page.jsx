"use client";

import { useState } from "react";
import { Save } from "lucide-react";

export default function SettingsPage() {
  const [msg, setMsg] = useState(null);

  return (
    <div>
      <h1 className="admin-title">Settings</h1>

      <div className="space-y-6">
        {/* Global Scheduler */}
        <div className="admin-card">
          <h2 className="text-lg font-semibold mb-4">Scheduler</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Der Autopilot prüft alle 30 Minuten ob ein Tenant einen neuen Post braucht.
            Die Frequenz pro Tenant wird in den Tenant-Einstellungen konfiguriert.
          </p>
          <div className="flex items-center gap-3">
            <span className="badge-success">Aktiv</span>
            <span className="text-sm text-muted-foreground">Intervall: 30 Minuten (fest)</span>
          </div>
        </div>

        {/* System Info */}
        <div className="admin-card">
          <h2 className="text-lg font-semibold mb-4">System</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Version</p>
              <p className="font-medium">Ghostwriter MVP</p>
            </div>
            <div>
              <p className="text-muted-foreground">Stack</p>
              <p className="font-medium">Next.js 14 + PostgreSQL 16</p>
            </div>
            <div>
              <p className="text-muted-foreground">Server</p>
              <p className="font-medium">Docker (95.111.228.131)</p>
            </div>
            <div>
              <p className="text-muted-foreground">Deploy</p>
              <p className="font-medium">Git Pull + Docker Build</p>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="admin-card border-red-200">
          <h2 className="text-lg font-semibold mb-4 text-red-700">Gefahrenzone</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Globaler Autopilot-Reset: Setzt alle next_run_at Werte zurück, sodass beim nächsten Scheduler-Lauf
            alle aktiven Tenants sofort geprüft werden.
          </p>
          <button
            onClick={async () => {
              const res = await fetch("/api/admin/reset-scheduler", { method: "POST" });
              const data = await res.json();
              setMsg(data.ok ? "Scheduler zurückgesetzt." : `Fehler: ${data.error}`);
            }}
            className="btn-destructive"
          >
            Scheduler zurücksetzen
          </button>
          {msg && <p className="text-sm mt-3 text-muted-foreground">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

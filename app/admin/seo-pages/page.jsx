"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle, XCircle, TrendingUp, FileText } from "lucide-react";

export default function SeoOverviewPage() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/seo/overview").then(r => r.json()).then(d => {
      setTenants(d.tenants || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="p-8 text-gray-400">Laden...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">SEO Hub</h1>
          <p className="text-gray-400 mt-1">Programmatic Landing Pages — Alle Tenants</p>
        </div>
      </div>

      <div className="grid gap-4">
        {tenants.map(t => (
          <Link key={t.slug} href={`/admin/seo-pages/${t.slug}`}
            className="block bg-gray-800 rounded-xl p-6 hover:bg-gray-750 transition border border-gray-700 hover:border-gray-500">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">{t.name}</h2>
                <p className="text-gray-400 text-sm mt-0.5">{t.slug}</p>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="text-center">
                  <div className="text-white font-bold text-xl">{t.published}</div>
                  <div className="text-gray-400">published</div>
                </div>
                {t.draft > 0 && (
                  <div className="text-center">
                    <div className="text-yellow-400 font-bold text-xl">{t.draft}</div>
                    <div className="text-gray-400">draft</div>
                  </div>
                )}
                {t.avg_pos && (
                  <div className="text-center">
                    <div className="text-blue-400 font-bold text-xl">{t.avg_pos}</div>
                    <div className="text-gray-400">Ø Pos.</div>
                  </div>
                )}
                {t.clicks_7d > 0 && (
                  <div className="text-center">
                    <div className="text-green-400 font-bold text-xl">{t.clicks_7d}</div>
                    <div className="text-gray-400">Klicks/7d</div>
                  </div>
                )}
              </div>
            </div>

            {(t.critical > 0 || t.warn > 0 || t.near_page1 > 0) && (
              <div className="flex gap-3 mt-4 pt-4 border-t border-gray-700">
                {t.critical > 0 && (
                  <span className="flex items-center gap-1.5 text-red-400 text-sm">
                    <XCircle className="w-4 h-4" /> {t.critical} kritisch
                  </span>
                )}
                {t.not_indexed > 0 && (
                  <span className="flex items-center gap-1.5 text-red-300 text-sm">
                    <FileText className="w-4 h-4" /> {t.not_indexed} nicht indexiert
                  </span>
                )}
                {t.warn > 0 && (
                  <span className="flex items-center gap-1.5 text-yellow-400 text-sm">
                    <AlertTriangle className="w-4 h-4" /> {t.warn} Warnungen
                  </span>
                )}
                {t.near_page1 > 0 && (
                  <span className="flex items-center gap-1.5 text-blue-400 text-sm">
                    <TrendingUp className="w-4 h-4" /> {t.near_page1} near page 1
                  </span>
                )}
              </div>
            )}
            {t.critical === 0 && t.warn === 0 && t.published > 0 && (
              <div className="flex items-center gap-1.5 mt-4 pt-4 border-t border-gray-700 text-green-400 text-sm">
                <CheckCircle className="w-4 h-4" /> Alles OK
              </div>
            )}
          </Link>
        ))}

        {tenants.length === 0 && (
          <div className="bg-gray-800 rounded-xl p-12 text-center text-gray-400">
            Noch keine Tenants mit SEO-Pages vorhanden.
          </div>
        )}
      </div>
    </div>
  );
}

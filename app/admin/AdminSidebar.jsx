"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2, Settings, FileText, Activity, LogOut } from "lucide-react";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/tenants", label: "Tenants", icon: Building2 },
  { href: "/admin/posts", label: "Posts", icon: FileText },
  { href: "/admin/logs", label: "Logs", icon: Activity },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="admin-sidebar">
      <div className="mb-8">
        <Link href="/admin" className="text-xl font-bold text-white block">
          Ghostwriter
        </Link>
        <p className="text-xs text-white/40 mt-1">Content Autopilot</p>
      </div>

      <nav className="space-y-1 flex-1">
        {links.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || (href !== "/admin" && pathname?.startsWith(href));
          return (
            <Link key={href} href={href} className={isActive ? "active" : ""}>
              <span className="flex items-center gap-3">
                <Icon size={16} />
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/10 transition-colors mt-auto"
      >
        <LogOut size={16} />
        Logout
      </button>
    </aside>
  );
}

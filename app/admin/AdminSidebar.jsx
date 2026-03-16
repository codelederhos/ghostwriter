"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2, Settings, FileText, Activity, LogOut, Menu, X } from "lucide-react";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/tenants", label: "Tenants", icon: Building2 },
  { href: "/admin/posts", label: "Posts", icon: FileText },
  { href: "/admin/logs", label: "Logs", icon: Activity },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-xl font-bold text-white block" onClick={() => setOpen(false)}>
            Ghostwriter
          </Link>
          <p className="text-xs text-white/40 mt-1">Content Autopilot</p>
        </div>
        <button onClick={() => setOpen(false)} className="md:hidden text-white/60 hover:text-white">
          <X size={20} />
        </button>
      </div>

      <nav className="space-y-1 flex-1">
        {links.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || (href !== "/admin" && pathname?.startsWith(href));
          return (
            <Link key={href} href={href} className={isActive ? "active" : ""} onClick={() => setOpen(false)}>
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
    </>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="admin-sidebar hidden md:flex">
        {nav}
      </aside>

      {/* Mobile Hamburger */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-foreground px-4 py-3 flex items-center justify-between">
        <Link href="/admin" className="text-base font-bold text-white">Ghostwriter</Link>
        <button onClick={() => setOpen(true)} className="text-white/70 hover:text-white">
          <Menu size={22} />
        </button>
      </div>

      {/* Mobile Overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative admin-sidebar w-64 flex">
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function KundeLayout({ children }) {
  const session = await getSession();
  if (!session || session.role !== "customer") {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-white border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/kunde" className="text-lg font-bold">Ghostwriter</Link>
            <span className="text-sm text-muted-foreground">Kundenpanel</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{session.name || session.email}</span>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}

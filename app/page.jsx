import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-foreground text-white">
      <div className="text-center max-w-lg px-6">
        <h1 className="text-4xl font-bold mb-4">Ghostwriter</h1>
        <p className="text-white/60 text-lg mb-8">
          Autonomes SEO-Content-System. Schreibt Blog-Artikel und postet auf Google Business Profile.
        </p>
        <div className="flex justify-center">
          <Link href="/login" className="inline-flex items-center justify-center px-6 py-3 bg-white text-foreground rounded-lg font-medium hover:bg-white/90 transition-colors">
            Login
          </Link>
        </div>
        <p className="text-white/30 text-xs mt-12">by Code Lederhos &nbsp;·&nbsp; <a href="/datenschutz" className="underline hover:text-white/50">Datenschutz</a></p>
      </div>
    </div>
  );
}

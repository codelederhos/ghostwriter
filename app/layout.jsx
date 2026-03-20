import "./globals.css";

export const metadata = {
  title: "Ghostwriter — Autonomes SEO-Content-System",
  description: "Multi-Tenant SaaS für automatische Blog-Artikel und Google Business Profile Posts.",
  verification: {
    google: "f3ZRghlIxgAY2qMwCHeuKPAqwkm_jiyja-HfFsYJn9s",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body className="bg-background text-foreground antialiased">
        {children}
        <footer style={{ textAlign: "center", padding: "1rem", fontSize: "0.75rem", color: "#9ca3af" }}>
          <a href="https://ghostwriter.code-lederhos.de/datenschutz" style={{ color: "inherit" }}>Datenschutzerklärung</a>
        </footer>
      </body>
    </html>
  );
}

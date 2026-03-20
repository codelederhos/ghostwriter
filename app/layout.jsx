import "./globals.css";

const PRIVACY_URL = "https://ghostwriter.code-lederhos.de/datenschutz";

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
      <head>
        {/* Maschinenlesbarer Privacy-Policy Link für Google OAuth Branding Check */}
        <link rel="privacy-policy" href={PRIVACY_URL} />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
        <footer style={{ textAlign: "center", padding: "1.5rem", fontSize: "0.8rem", color: "#6b7280", borderTop: "1px solid #e5e7eb" }}>
          <a
            href={PRIVACY_URL}
            rel="privacy-policy"
            style={{ color: "#6b7280", textDecoration: "underline" }}
          >
            Datenschutzerklärung / Privacy Policy
          </a>
        </footer>
      </body>
    </html>
  );
}

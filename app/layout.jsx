import "./globals.css";

export const metadata = {
  title: "Ghostwriter — Autonomes SEO-Content-System",
  description: "Multi-Tenant SaaS für automatische Blog-Artikel und Google Business Profile Posts.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}

import "./globals.css";

export const metadata = {
  title: "Ghostwriter — Autonomes SEO-Content-System",
  description: "Multi-Tenant SaaS für automatische Blog-Artikel und Google Business Profile Posts.",
  verification: {
    google: "B5AljjC8cvQQwYPIPR169JrsL2OuMFZIWvrb9JDphLI",
  },
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

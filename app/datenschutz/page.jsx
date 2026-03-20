export const metadata = {
  title: "Datenschutz — Ghostwriter",
  robots: { index: false },
};

export default function DatenschutzPage() {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "3rem 1.5rem", fontFamily: "sans-serif", lineHeight: 1.7, color: "#1a1a1a" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "1.5rem" }}>Datenschutzerklärung</h1>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginTop: "2rem" }}>1. Verantwortlicher</h2>
      <p>Stanislaw Lederhos, codelederhos@gmail.com</p>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginTop: "2rem" }}>2. Erhobene Daten</h2>
      <p>Diese Anwendung ist ein internes SaaS-Tool. Es werden keine personenbezogenen Daten von Endnutzern erhoben oder gespeichert.</p>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginTop: "2rem" }}>3. Google OAuth</h2>
      <p>Die Anwendung nutzt Google OAuth 2.0 ausschließlich für den Zugriff auf Google Drive (Lesezugriff). Tokens werden verschlüsselt gespeichert und nicht an Dritte weitergegeben.</p>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginTop: "2rem" }}>4. Kontakt</h2>
      <p>Bei Fragen: codelederhos@gmail.com</p>
    </main>
  );
}

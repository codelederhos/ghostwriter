import DraftWorkspace from "./DraftWorkspace";

export const dynamic = "force-dynamic";

export const metadata = { title: "Draft-Review — Ghostwriter Admin" };

/**
 * /admin/drafts/[id] — Detail-Workspace fuer einen Review-Draft.
 * Auth laeuft ueber das Admin-Layout (redirect auf /login ohne Admin-Session);
 * alle Daten kommen client-seitig aus den requireAdmin-gesicherten APIs.
 */
export default async function DraftDetailPage(props) {
 const params = await props.params;
 return <DraftWorkspace draftId={params.id} />;
}

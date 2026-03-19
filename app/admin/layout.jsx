import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AdminSidebar from "./AdminSidebar";
import PipelinePill from "./PipelinePill";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminSidebar />
      <div className="admin-main">
        {children}
      </div>
      <PipelinePill />
    </div>
  );
}

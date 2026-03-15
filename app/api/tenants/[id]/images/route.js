import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const { rows } = await query(
    "SELECT * FROM tenant_reference_images WHERE tenant_id = $1 ORDER BY type, slot_index, created_at",
    [id]
  );
  return NextResponse.json({ images: rows });
}

export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const body = await req.json();
  const { action } = body;

  switch (action) {
    case "upsert_persona": {
      const { slot_index, image_url, thumb_url, description } = body;
      await query(
        "DELETE FROM tenant_reference_images WHERE tenant_id = $1 AND type = 'persona' AND slot_index = $2",
        [id, slot_index]
      );
      if (image_url) {
        await query(
          "INSERT INTO tenant_reference_images (tenant_id, type, image_url, thumb_url, description, slot_index) VALUES ($1, 'persona', $2, $3, $4, $5)",
          [id, image_url, thumb_url || null, description || null, slot_index]
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "add_post_image": {
      const { image_url, thumb_url, description, categories } = body;
      const { rows: [img] } = await query(
        "INSERT INTO tenant_reference_images (tenant_id, type, image_url, thumb_url, description, categories) VALUES ($1, 'post', $2, $3, $4, $5) RETURNING *",
        [id, image_url, thumb_url || null, description || null, categories || []]
      );
      return NextResponse.json({ ok: true, image: img });
    }

    case "update_post_image": {
      const { imageId, description, categories } = body;
      await query(
        "UPDATE tenant_reference_images SET description = $2, categories = $3 WHERE id = $1",
        [imageId, description, categories || []]
      );
      return NextResponse.json({ ok: true });
    }

    case "delete_image": {
      const { imageId } = body;
      await query("DELETE FROM tenant_reference_images WHERE id = $1 AND tenant_id = $2", [imageId, id]);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

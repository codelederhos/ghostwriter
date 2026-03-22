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

    case "update_image_meta": {
      const allowed = ["description", "room_type", "condition_tag", "ai_tags", "property_id", "sequence_group"];
      const sets = [];
      const vals = [body.imageId];
      let i = 2;
      for (const field of allowed) {
        if (body[field] !== undefined) {
          sets.push(`${field} = $${i++}`);
          vals.push(body[field]);
        }
      }
      if (sets.length === 0) return NextResponse.json({ ok: true });
      await query(`UPDATE tenant_reference_images SET ${sets.join(", ")} WHERE id = $1`, vals);
      return NextResponse.json({ ok: true });
    }

    case "link_images": {
      // Assign same sequence_group to multiple images
      const { imageIds, groupId } = body;
      const group = groupId || crypto.randomUUID();
      if (imageIds?.length > 0) {
        await query(
          `UPDATE tenant_reference_images SET sequence_group = $2 WHERE id = ANY($1::uuid[])`,
          [imageIds, group]
        );
      }
      return NextResponse.json({ ok: true, group });
    }

    case "unlink_image": {
      const { imageId } = body;
      await query(`UPDATE tenant_reference_images SET sequence_group = NULL WHERE id = $1`, [imageId]);
      return NextResponse.json({ ok: true });
    }

    case "bulk_assign": {
      const { imageIds, propertyId, conditionTag } = body;
      if (!imageIds?.length) return NextResponse.json({ ok: true });
      const sets = [];
      const vals = [imageIds];
      let i = 2;
      if (propertyId !== undefined) { sets.push(`property_id = $${i++}`); vals.push(propertyId || null); }
      if (conditionTag !== undefined) { sets.push(`condition_tag = $${i++}`); vals.push(conditionTag); }
      if (sets.length === 0) return NextResponse.json({ ok: true });
      await query(
        `UPDATE tenant_reference_images SET ${sets.join(", ")} WHERE id = ANY($1::uuid[])`,
        vals
      );
      return NextResponse.json({ ok: true });
    }

    case "delete_image": {
      const { imageId } = body;
      await query("DELETE FROM tenant_reference_images WHERE id = $1 AND tenant_id = $2", [imageId, id]);
      return NextResponse.json({ ok: true });
    }

    case "bulk_delete": {
      const { imageIds } = body;
      if (!imageIds?.length) return NextResponse.json({ ok: true });
      await query(
        "DELETE FROM tenant_reference_images WHERE id = ANY($1::uuid[]) AND tenant_id = $2",
        [imageIds, id]
      );
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

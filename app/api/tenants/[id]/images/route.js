import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateImage } from "@/lib/providers/image";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const { searchParams } = new URL(req.url);
  const parentId = searchParams.get("parent_id");

  // Stammbaum-Query: alle Nachkommen eines Bildes
  if (parentId) {
    const { rows } = await query(
      `WITH RECURSIVE tree AS (
        SELECT * FROM tenant_reference_images WHERE id = $1
        UNION ALL
        SELECT ri.* FROM tenant_reference_images ri JOIN tree t ON ri.parent_image_id = t.id
      )
      SELECT * FROM tree ORDER BY created_at`,
      [parentId]
    );
    return NextResponse.json({ images: rows });
  }

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
      const { image_url, thumb_url, description, categories, approval_status: reqStatus } = body;
      const status = reqStatus || "pending";
      const { rows: [img] } = await query(
        "INSERT INTO tenant_reference_images (tenant_id, type, image_url, thumb_url, description, categories, approval_status) VALUES ($1, 'post', $2, $3, $4, $5, $6) RETURNING *",
        [id, image_url, thumb_url || null, description || null, categories || [], status]
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

    // ── Freigabe-Workflow ──────────────────────────────────────────

    case "approve": {
      const { imageId } = body;
      await query(
        "UPDATE tenant_reference_images SET approval_status = 'approved', approved_at = NOW(), approval_note = NULL WHERE id = $1 AND tenant_id = $2",
        [imageId, id]
      );
      return NextResponse.json({ ok: true });
    }

    case "reject": {
      const { imageId, note } = body;
      await query(
        "UPDATE tenant_reference_images SET approval_status = 'rejected', approval_note = $3 WHERE id = $1 AND tenant_id = $2",
        [imageId, id, note || null]
      );
      return NextResponse.json({ ok: true });
    }

    case "bulk_approve": {
      const { imageIds } = body;
      if (!imageIds?.length) return NextResponse.json({ ok: true });
      await query(
        "UPDATE tenant_reference_images SET approval_status = 'approved', approved_at = NOW(), approval_note = NULL WHERE id = ANY($1::uuid[]) AND tenant_id = $2",
        [imageIds, id]
      );
      return NextResponse.json({ ok: true });
    }

    case "bulk_reject": {
      const { imageIds, note } = body;
      if (!imageIds?.length) return NextResponse.json({ ok: true });
      await query(
        "UPDATE tenant_reference_images SET approval_status = 'rejected', approval_note = $3 WHERE id = ANY($1::uuid[]) AND tenant_id = $2",
        [imageIds, id, note || null]
      );
      return NextResponse.json({ ok: true });
    }

    case "set_pending": {
      const { imageId } = body;
      await query(
        "UPDATE tenant_reference_images SET approval_status = 'pending', approved_at = NULL, approval_note = NULL WHERE id = $1 AND tenant_id = $2",
        [imageId, id]
      );
      return NextResponse.json({ ok: true });
    }

    // ── KI-Generierung aus Referenzbild ────────────────────────────

    case "generate_variant": {
      const { imageId: sourceId, prompt, provider, format } = body;
      if (!sourceId || !prompt) {
        return NextResponse.json({ error: "imageId und prompt sind Pflicht" }, { status: 400 });
      }

      // Quellbild laden
      const { rows: [source] } = await query(
        "SELECT * FROM tenant_reference_images WHERE id = $1 AND tenant_id = $2",
        [sourceId, id]
      );
      if (!source) return NextResponse.json({ error: "Quellbild nicht gefunden" }, { status: 404 });

      // Tenant-Settings für API-Key
      const { rows: [ts] } = await query(
        "SELECT image_provider, image_api_key, image_model, image_custom_endpoint FROM tenant_settings WHERE tenant_id = $1",
        [id]
      );
      if (!ts?.image_api_key) {
        return NextResponse.json({ error: "Kein Image-API-Key konfiguriert" }, { status: 400 });
      }

      const decryptedKey = decrypt(ts.image_api_key);
      const imgProvider = provider || ts.image_provider || "dalle3";
      const imgModel = ts.image_model || "gpt-image-1";

      // Referenz-URL für gpt-image-1
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
      const referenceUrl = source.image_url.startsWith("http")
        ? source.image_url
        : `${baseUrl}${source.image_url}`;

      const settings = {
        image_provider: imgProvider,
        image_api_key: decryptedKey,
        image_model: imgModel,
        image_custom_endpoint: ts.image_custom_endpoint,
      };

      const slug = `ai-variant-${Date.now()}`;
      const result = await generateImage(settings, prompt, slug, {
        format: format || "landscape",
        referenceImageUrl: referenceUrl,
      });

      // Neues Bild in DB mit Verknüpfung zum Original
      const { rows: [newImg] } = await query(
        `INSERT INTO tenant_reference_images
          (tenant_id, type, image_url, thumb_url, description,
           parent_image_id, is_ai_generated, generation_prompt, generation_provider, generation_model,
           approval_status, property_id, room_type, condition_tag, categories)
        VALUES ($1, 'post', $2, $3, $4,
           $5, true, $6, $7, $8,
           'pending', $9, $10, $11, $12)
        RETURNING *`,
        [
          id, result.localPath, null, `KI-Variante: ${prompt.slice(0, 100)}`,
          sourceId, prompt, imgProvider, imgModel,
          source.property_id, source.room_type, source.condition_tag, source.categories || [],
        ]
      );

      return NextResponse.json({ ok: true, image: newImg });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

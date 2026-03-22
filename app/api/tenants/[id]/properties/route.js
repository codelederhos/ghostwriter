import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const { rows } = await query(
    `SELECT p.*, COUNT(i.id)::int AS image_count
     FROM tenant_properties p
     LEFT JOIN tenant_reference_images i ON i.property_id = p.id
     WHERE p.tenant_id = $1
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [id]
  );
  return NextResponse.json({ properties: rows });
}

export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const body = await req.json();
  const { action } = body;

  switch (action) {
    case "create": {
      const { name, address, lat, lng, type, parent_id } = body;
      const { rows: [prop] } = await query(
        `INSERT INTO tenant_properties (tenant_id, name, address, lat, lng, type, parent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, name, address || null, lat || null, lng || null, type || "haus", parent_id || null]
      );
      return NextResponse.json({ ok: true, property: { ...prop, image_count: 0 } });
    }

    case "update": {
      const { propertyId, name, address, lat, lng, type, parent_id } = body;
      const { rows: [prop] } = await query(
        `UPDATE tenant_properties SET name = $2, address = $3, lat = $4, lng = $5, type = $6, parent_id = $7
         WHERE id = $1 AND tenant_id = $8 RETURNING *`,
        [propertyId, name, address || null, lat || null, lng || null, type || "haus", parent_id || null, id]
      );
      return NextResponse.json({ ok: true, property: prop });
    }

    case "delete": {
      const { propertyId } = body;
      await query(
        "DELETE FROM tenant_properties WHERE id = $1 AND tenant_id = $2",
        [propertyId, id]
      );
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

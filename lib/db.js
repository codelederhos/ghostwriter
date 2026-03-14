import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function getClient() {
  const client = await pool.connect();
  return client;
}

export default pool;

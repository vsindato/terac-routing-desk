import "dotenv/config";
import { execSync } from "node:child_process";
import { Client } from "pg";

/** Creates the test database if needed and applies every migration to it. */
export default async function setup() {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is not set. Copy .env.example to .env.");

  const databaseName = new URL(testUrl).pathname.slice(1);
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
  if (rowCount === 0) await admin.query(`CREATE DATABASE "${databaseName}"`);
  await admin.end();

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "ignore",
  });
}

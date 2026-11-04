import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  if (process.argv.includes("--reset")) {
    await c.query("drop schema public cascade; create schema public;");
    console.log("Schema reset");
  }
  await c.query("create table if not exists schema_migration (name text primary key, applied_at timestamptz default now())");
  const dir = path.resolve("db/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const done = await c.query("select 1 from schema_migration where name=$1", [f]);
    if (done.rowCount) continue;
    await c.query("begin");
    await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
    await c.query("insert into schema_migration(name) values ($1)", [f]);
    await c.query("commit");
    console.log("Applied", f);
  }
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });

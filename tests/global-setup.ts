import { execSync } from "node:child_process";
// Fresh schema + full demo seed (which itself drives the workflow engine end-to-end) in the test database
export default function setup() {
  const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://enversys:enversys@localhost:5432/enversys_test", STORAGE_DIR: "./storage-test" };
  execSync("npx tsx scripts/migrate.ts --reset", { env, stdio: "inherit" });
  execSync("npx tsx scripts/seed.ts", { env, stdio: ["ignore", "ignore", "inherit"] });
}

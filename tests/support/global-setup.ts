import { runMigrations } from "@/server/db/migrate";

export default async function setup() {
  await runMigrations(process.env.DATABASE_URL ?? "postgres://drive:drive@localhost:55432/drive_test");
}

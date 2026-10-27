import { runMigrations } from "../src/server/db/migrate";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL이 필요합니다");
  }
  await runMigrations(url);
  console.log("마이그레이션 완료");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

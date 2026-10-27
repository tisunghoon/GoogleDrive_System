import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { createDatabase, type Database } from "@/server/db/client";
import { files, fileVersions, namespaces, users } from "@/server/db/schema";

const TABLES = [
  "events",
  "shares",
  "upload_session_blocks",
  "upload_sessions",
  "block_objects",
  "blocks",
  "file_version_keeps",
  "file_versions",
  "files",
  "namespaces",
  "devices",
  "users",
];

// 테스트 파일마다 연결을 하나 열고, 각 테스트 전에 모든 테이블을 비운다
export function setupTestDatabase(): Database {
  const { db, close } = createDatabase(process.env.DATABASE_URL!);
  beforeEach(async () => {
    await db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
  });
  afterAll(close);
  return db;
}

let sequence = 0;

export async function createUserWithNamespace(db: Database) {
  sequence += 1;
  const [user] = await db
    .insert(users)
    .values({ email: `user${sequence}@example.com`, userName: `user${sequence}`, passwordHash: "x" })
    .returning();
  const [namespace] = await db.insert(namespaces).values({ ownerId: user.id }).returning();
  return { user, namespace };
}

export async function createFile(db: Database, namespaceId: number, relativePath = "/report.txt") {
  const [file] = await db
    .insert(files)
    .values({
      namespaceId,
      relativePath,
      fileName: relativePath.split("/").pop()!,
      isDirectory: false,
    })
    .returning();
  return file;
}

export async function createUploadedVersion(db: Database, fileId: number, versionNumber = 1) {
  const [version] = await db
    .insert(fileVersions)
    .values({ fileId, versionNumber, status: "uploaded", size: 10, checksum: "a".repeat(64) })
    .returning();
  return version;
}

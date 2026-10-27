import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const MAX_FILE_SIZE = 10_737_418_240;
export const MAX_BLOCK_SIZE = 4_194_304;
export const DEFAULT_QUOTA_BYTES = 10_737_418_240;

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const id = () => bigserial("id", { mode: "number" }).primaryKey();
const userRef = (name: string) =>
  bigint(name, { mode: "number" })
    .notNull()
    .references(() => users.id);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: varchar("email", { length: 254 }).notNull().unique(),
    userName: varchar("user_name", { length: 64 }).notNull(),
    passwordHash: varchar("password_hash", { length: 72 }).notNull(),
    quotaBytes: bigint("quota_bytes", { mode: "number" }).notNull().default(DEFAULT_QUOTA_BYTES),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [check("users_used_bytes_non_negative", sql`${t.usedBytes} >= 0`)],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef("user_id"),
    name: varchar("name", { length: 64 }).notNull(),
    pushId: varchar("push_id", { length: 255 }),
    lastLoggedInAt: timestamp("last_logged_in_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("devices_user_idx").on(t.userId)],
);

export const namespaces = pgTable("namespaces", {
  id: id(),
  ownerId: userRef("owner_id").unique(),
  isShared: boolean("is_shared").notNull().default(false),
  createdAt: createdAt(),
});

export const files = pgTable(
  "files",
  {
    id: id(),
    namespaceId: bigint("namespace_id", { mode: "number" })
      .notNull()
      .references(() => namespaces.id),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    relativePath: varchar("relative_path", { length: 1024 }).notNull(),
    isDirectory: boolean("is_directory").notNull(),
    // uploaded 버전이 하나도 없으면 NULL이고 목록에서 제외된다
    latestVersion: integer("latest_version"),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    checksum: char("checksum", { length: 64 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    lastModified: timestamp("last_modified", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("files_live_path_uniq").on(t.namespaceId, t.relativePath).where(sql`${t.deletedAt} IS NULL`),
    index("files_modified_idx").on(t.namespaceId, t.lastModified.desc().nullsFirst()),
  ],
);

export const fileVersions = pgTable(
  "file_versions",
  {
    id: id(),
    fileId: bigint("file_id", { mode: "number" })
      .notNull()
      .references(() => files.id),
    deviceId: uuid("device_id").references(() => devices.id),
    // 완료 트랜잭션에서 부여한다. pending·expired 버전이 번호를 차지하지 않게 하기 위해서다
    versionNumber: integer("version_number"),
    status: varchar("status", { length: 16, enum: ["pending", "uploaded", "expired"] }).notNull(),
    baseVersion: integer("base_version"),
    size: bigint("size", { mode: "number" }).notNull(),
    checksum: char("checksum", { length: 64 }).notNull(),
    createdAt: createdAt(),
    lastModified: timestamp("last_modified", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("file_versions_file_version_uniq").on(t.fileId, t.versionNumber),
    check("file_versions_status_check", sql`${t.status} IN ('pending', 'uploaded', 'expired')`),
    check("file_versions_size_check", sql`${t.size} BETWEEN 0 AND ${sql.raw(String(MAX_FILE_SIZE))}`),
    check("file_versions_number_iff_uploaded", sql`(${t.status} = 'uploaded') = (${t.versionNumber} IS NOT NULL)`),
  ],
);

// 보관 표시를 file_versions 컬럼으로 두면 읽기 전용인 uploaded 행을 고쳐야 하므로 분리했다
export const fileVersionKeeps = pgTable("file_version_keeps", {
  fileVersionId: bigint("file_version_id", { mode: "number" })
    .primaryKey()
    .references(() => fileVersions.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const blocks = pgTable(
  "blocks",
  {
    id: id(),
    fileVersionId: bigint("file_version_id", { mode: "number" })
      .notNull()
      .references(() => fileVersions.id, { onDelete: "cascade" }),
    blockOrder: integer("block_order").notNull(),
    hash: char("hash", { length: 64 }).notNull(),
    size: integer("size").notNull(),
  },
  (t) => [
    unique("blocks_version_order_uniq").on(t.fileVersionId, t.blockOrder),
    index("blocks_hash_idx").on(t.hash),
    check("blocks_order_check", sql`${t.blockOrder} >= 0`),
    check("blocks_size_check", sql`${t.size} BETWEEN 1 AND ${sql.raw(String(MAX_BLOCK_SIZE))}`),
  ],
);

export const blockObjects = pgTable(
  "block_objects",
  {
    accountId: userRef("account_id"),
    hash: char("hash", { length: 64 }).notNull(),
    size: integer("size").notNull(),
    storedSize: integer("stored_size").notNull(),
    storageTier: varchar("storage_tier", { length: 8, enum: ["hot", "cold"] })
      .notNull()
      .default("hot"),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.hash] }),
    check("block_objects_tier_check", sql`${t.storageTier} IN ('hot', 'cold')`),
  ],
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileVersionId: bigint("file_version_id", { mode: "number" })
      .notNull()
      .unique()
      .references(() => fileVersions.id),
    accountId: userRef("account_id"),
    userId: userRef("user_id"),
    status: varchar("status", { length: 16, enum: ["open", "completed", "conflicted", "expired"] }).notNull(),
    // 완료 결과를 남겨 같은 세션의 완료 요청에 같은 응답을 돌려준다
    result: jsonb("result"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("upload_sessions_status_check", sql`${t.status} IN ('open', 'completed', 'conflicted', 'expired')`)],
);

export const uploadSessionBlocks = pgTable(
  "upload_session_blocks",
  {
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploadSessions.id, { onDelete: "cascade" }),
    hash: char("hash", { length: 64 }).notNull(),
    received: boolean("received").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.uploadId, t.hash] })],
);

export const shares = pgTable(
  "shares",
  {
    id: id(),
    namespaceId: bigint("namespace_id", { mode: "number" })
      .notNull()
      .references(() => namespaces.id),
    folderPath: varchar("folder_path", { length: 1024 }).notNull(),
    granteeId: userRef("grantee_id"),
    role: varchar("role", { length: 8, enum: ["viewer", "editor"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("shares_folder_grantee_uniq").on(t.namespaceId, t.folderPath, t.granteeId),
    index("shares_grantee_idx").on(t.granteeId),
    check("shares_role_check", sql`${t.role} IN ('viewer', 'editor')`),
  ],
);

// 영속 이벤트 로그. 오프라인 사용자 백업 큐 역할을 겸한다
export const events = pgTable(
  "events",
  {
    id: id(),
    namespaceId: bigint("namespace_id", { mode: "number" })
      .notNull()
      .references(() => namespaces.id),
    type: varchar("type", {
      length: 16,
      enum: ["file_added", "file_updated", "file_deleted", "upload_started", "share_created"],
    }).notNull(),
    path: varchar("path", { length: 1024 }).notNull(),
    versionNumber: integer("version_number"),
    deviceId: uuid("device_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_ns_id_idx").on(t.namespaceId, t.id),
    check(
      "events_type_check",
      sql`${t.type} IN ('file_added', 'file_updated', 'file_deleted', 'upload_started', 'share_created')`,
    ),
  ],
);

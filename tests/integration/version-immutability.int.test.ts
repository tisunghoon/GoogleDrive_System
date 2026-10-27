import { eq } from "drizzle-orm";
import fc from "fast-check";
import { expect, test } from "vitest";
import { pgErrorCode } from "@/server/db/client";
import { fileVersions } from "@/server/db/schema";
import { createFile, createUploadedVersion, createUserWithNamespace, setupTestDatabase } from "../support/db";

const db = setupTestDatabase();

const versionChange = fc
  .record(
    {
      size: fc.integer({ min: 0, max: 1_000_000 }),
      checksum: fc.stringMatching(/^[0-9a-f]{64}$/),
      status: fc.constantFrom("pending" as const, "uploaded" as const, "expired" as const),
      versionNumber: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
      baseVersion: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
      lastModified: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01"), noInvalidDate: true }),
    },
    { requiredKeys: [] },
  )
  .filter((change) => Object.keys(change).length > 0);

// 실제 DB에 행을 만들고 지우는 속성이라 100회 대신 50회로 돌린다
test("Feature: google-drive-system, Property 10: uploaded 버전 불변", async () => {
  const { namespace } = await createUserWithNamespace(db);
  const file = await createFile(db, namespace.id);
  const original = await createUploadedVersion(db, file.id);

  await fc.assert(
    fc.asyncProperty(versionChange, async (change) => {
      const error = await db
        .update(fileVersions)
        .set(change)
        .where(eq(fileVersions.id, original.id))
        .then(
          () => undefined,
          (e: unknown) => e,
        );

      expect(pgErrorCode(error)).toBe("23000");
      const [current] = await db.select().from(fileVersions).where(eq(fileVersions.id, original.id));
      expect(current).toEqual(original);
    }),
    { numRuns: 50 },
  );
});

test("uploaded 버전도 정리 작업을 위해 삭제는 할 수 있다", async () => {
  const { namespace } = await createUserWithNamespace(db);
  const version = await createUploadedVersion(db, (await createFile(db, namespace.id)).id);

  await db.delete(fileVersions).where(eq(fileVersions.id, version.id));

  expect(await db.select().from(fileVersions).where(eq(fileVersions.id, version.id))).toEqual([]);
});

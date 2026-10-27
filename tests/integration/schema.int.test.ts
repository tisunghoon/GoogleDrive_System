import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { pgErrorCode } from "@/server/db/client";
import { blocks, files, fileVersions, users } from "@/server/db/schema";
import { createFile, createUploadedVersion, createUserWithNamespace, setupTestDatabase } from "../support/db";

const db = setupTestDatabase();

async function expectPgError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, "쿼리가 실패해야 한다").toBeDefined();
  expect(pgErrorCode(error)).toBe(code);
}

describe("파일 경로 유일성 (요구사항 2.1)", () => {
  test("같은 namespace에 삭제되지 않은 같은 경로를 두 번 만들 수 없다", async () => {
    const { namespace } = await createUserWithNamespace(db);
    await createFile(db, namespace.id, "/a.txt");

    await expectPgError(createFile(db, namespace.id, "/a.txt"), "23505");
  });

  test("삭제된 파일과 같은 경로에는 새 파일을 만들 수 있다", async () => {
    const { namespace } = await createUserWithNamespace(db);
    const old = await createFile(db, namespace.id, "/a.txt");
    await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, old.id));

    await expect(createFile(db, namespace.id, "/a.txt")).resolves.toMatchObject({ relativePath: "/a.txt" });
  });

  test("다른 namespace에는 같은 경로를 만들 수 있다", async () => {
    const first = await createUserWithNamespace(db);
    const second = await createUserWithNamespace(db);
    await createFile(db, first.namespace.id, "/a.txt");

    await expect(createFile(db, second.namespace.id, "/a.txt")).resolves.toBeDefined();
  });
});

describe("버전 번호와 상태 (요구사항 7.5)", () => {
  test("uploaded 상태인데 버전 번호가 없으면 거부한다", async () => {
    const { namespace } = await createUserWithNamespace(db);
    const file = await createFile(db, namespace.id);

    await expectPgError(
      db.insert(fileVersions).values({ fileId: file.id, status: "uploaded", size: 1, checksum: "a".repeat(64) }),
      "23514",
    );
  });

  test("pending 상태인데 버전 번호가 있으면 거부한다", async () => {
    const { namespace } = await createUserWithNamespace(db);
    const file = await createFile(db, namespace.id);

    await expectPgError(
      db
        .insert(fileVersions)
        .values({ fileId: file.id, status: "pending", versionNumber: 1, size: 1, checksum: "a".repeat(64) }),
      "23514",
    );
  });

  test("한 파일에 같은 버전 번호를 두 번 쓸 수 없다", async () => {
    const { namespace } = await createUserWithNamespace(db);
    const file = await createFile(db, namespace.id);
    await createUploadedVersion(db, file.id, 1);

    await expectPgError(createUploadedVersion(db, file.id, 1), "23505");
  });

  test("pending 버전은 여러 개여도 번호가 없으므로 충돌하지 않는다", async () => {
    const { namespace } = await createUserWithNamespace(db);
    const file = await createFile(db, namespace.id);
    const pending = { fileId: file.id, status: "pending" as const, size: 1, checksum: "a".repeat(64) };

    await db.insert(fileVersions).values([pending, pending]);
  });

  test("pending 버전은 uploaded로 바꿀 수 있다", async () => {
    const { namespace } = await createUserWithNamespace(db);
    const file = await createFile(db, namespace.id);
    const [version] = await db
      .insert(fileVersions)
      .values({ fileId: file.id, status: "pending", size: 1, checksum: "a".repeat(64) })
      .returning();

    await db.update(fileVersions).set({ status: "uploaded", versionNumber: 1 }).where(eq(fileVersions.id, version.id));
  });
});

describe("크기 범위", () => {
  test.each([0, 4_194_305])("블록 크기 %i는 거부한다", async (size) => {
    const { namespace } = await createUserWithNamespace(db);
    const version = await createUploadedVersion(db, (await createFile(db, namespace.id)).id);

    await expectPgError(
      db.insert(blocks).values({ fileVersionId: version.id, blockOrder: 0, hash: "b".repeat(64), size }),
      "23514",
    );
  });

  test("블록 크기 4,194,304는 허용한다", async () => {
    const { namespace } = await createUserWithNamespace(db);
    const version = await createUploadedVersion(db, (await createFile(db, namespace.id)).id);

    await db.insert(blocks).values({ fileVersionId: version.id, blockOrder: 0, hash: "b".repeat(64), size: 4_194_304 });
  });

  test("10GB를 넘는 파일 버전은 거부한다", async () => {
    const { namespace } = await createUserWithNamespace(db);
    const file = await createFile(db, namespace.id);

    await expectPgError(
      db
        .insert(fileVersions)
        .values({ fileId: file.id, status: "pending", size: 10_737_418_241, checksum: "a".repeat(64) }),
      "23514",
    );
  });

  test("사용량은 음수가 될 수 없다", async () => {
    const { user } = await createUserWithNamespace(db);

    await expectPgError(db.update(users).set({ usedBytes: -1 }).where(eq(users.id, user.id)), "23514");
  });
});

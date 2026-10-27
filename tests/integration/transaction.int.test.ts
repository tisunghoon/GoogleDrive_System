import { describe, expect, test } from "vitest";
import { withTransaction } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { setupTestDatabase } from "../support/db";

const db = setupTestDatabase();

function pgError(code: string) {
  return Object.assign(new Error(`pg ${code}`), { code });
}

describe("withTransaction", () => {
  test.each(["40001", "40P01"])("오류 코드 %s면 다시 시도해 성공한다", async (code) => {
    let attempts = 0;

    const result = await withTransaction(db, async () => {
      attempts += 1;
      if (attempts < 3) throw pgError(code);
      return "done";
    });

    expect(result).toBe("done");
    expect(attempts).toBe(3);
  });

  test("세 번 모두 실패하면 마지막 오류를 던진다", async () => {
    let attempts = 0;

    await expect(
      withTransaction(db, async () => {
        attempts += 1;
        throw pgError("40001");
      }),
    ).rejects.toThrow("pg 40001");
    expect(attempts).toBe(3);
  });

  test("다시 시도할 수 없는 오류는 바로 던진다", async () => {
    let attempts = 0;

    await expect(
      withTransaction(db, async () => {
        attempts += 1;
        throw pgError("23505");
      }),
    ).rejects.toThrow("pg 23505");
    expect(attempts).toBe(1);
  });

  test("실패한 시도의 쓰기는 롤백된다", async () => {
    let attempts = 0;

    await withTransaction(db, async (tx) => {
      attempts += 1;
      await tx.insert(users).values({ email: `retry${attempts}@example.com`, userName: "u", passwordHash: "x" });
      if (attempts === 1) throw pgError("40001");
    });

    const rows = await db.select({ email: users.email }).from(users);
    expect(rows).toEqual([{ email: "retry2@example.com" }]);
  });
});

import { describe, expect, test } from "vitest";
import { pgErrorCode } from "@/server/db/client";

describe("pgErrorCode", () => {
  test("드라이버 오류의 code를 읽는다", () => {
    expect(pgErrorCode(Object.assign(new Error("x"), { code: "23505" }))).toBe("23505");
  });

  test("Drizzle이 cause로 감싼 오류에서도 code를 읽는다", () => {
    const driverError = Object.assign(new Error("x"), { code: "40001" });

    expect(pgErrorCode(new Error("query failed", { cause: driverError }))).toBe("40001");
  });

  test("cause가 순환해도 끝난다", () => {
    const error: Error & { cause?: unknown } = new Error("loop");
    error.cause = error;

    expect(pgErrorCode(error)).toBeUndefined();
  });

  test("code가 없으면 undefined", () => {
    expect(pgErrorCode(new Error("x"))).toBeUndefined();
    expect(pgErrorCode("not an error")).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
  });
});

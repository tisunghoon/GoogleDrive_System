import { describe, expect, test } from "vitest";
import { loadConfig } from "@/server/config";

const validEnv = {
  DATABASE_URL: "postgres://drive:drive@localhost:5432/drive",
  REDIS_URL: "redis://localhost:6379/0",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "minio",
  S3_SECRET_KEY: "minio-secret",
  JWT_SECRET: "x".repeat(32),
  BLOCK_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("loadConfig", () => {
  test("필수 값만 주면 나머지는 설계서의 기본값을 쓴다", () => {
    const config = loadConfig(validEnv);

    expect(config.S3_BUCKET_PRIMARY).toBe("drive-region-a");
    expect(config.S3_BUCKET_REPLICA).toBe("drive-region-b");
    expect(config.S3_BUCKET_COLD).toBe("drive-cold");
    expect(config.LONG_POLL_TIMEOUT_MS).toBe(60_000);
    expect(config.LONG_POLL_MAX_CONNECTIONS).toBe(10_000);
    expect(config.UPLOAD_SESSION_TTL_HOURS).toBe(24);
    expect(config.EVENT_RETENTION_DAYS).toBe(30);
    expect(config.COLD_STORAGE_AFTER_DAYS).toBe(90);
    expect(config.MAX_VERSIONS_PER_FILE).toBe(100);
  });

  test("암호화 키를 32바이트 Buffer로 디코딩한다", () => {
    const config = loadConfig(validEnv);

    expect(config.BLOCK_ENCRYPTION_KEY).toEqual(Buffer.alloc(32, 7));
  });

  test("숫자 설정은 문자열 환경 변수에서 정수로 바꾼다", () => {
    const config = loadConfig({ ...validEnv, LONG_POLL_TIMEOUT_MS: "1500" });

    expect(config.LONG_POLL_TIMEOUT_MS).toBe(1500);
  });

  test("32바이트가 아닌 암호화 키는 거부한다", () => {
    const env = { ...validEnv, BLOCK_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") };

    expect(() => loadConfig(env)).toThrow(/BLOCK_ENCRYPTION_KEY/);
  });

  test("32자보다 짧은 JWT 비밀 값은 거부한다", () => {
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });

  test("빠진 필수 값을 모두 오류 메시지에 담는다", () => {
    const env = { ...validEnv, DATABASE_URL: undefined, REDIS_URL: undefined };

    expect(() => loadConfig(env)).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  test("0 이하의 숫자 설정은 거부한다", () => {
    expect(() => loadConfig({ ...validEnv, MAX_VERSIONS_PER_FILE: "0" })).toThrow(/MAX_VERSIONS_PER_FILE/);
  });
});

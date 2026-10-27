import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"], environment: "node" },
      },
      {
        extends: true,
        test: { name: "property", include: ["tests/property/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.int.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30_000,
          globalSetup: ["tests/support/global-setup.ts"],
          // docker-compose.test.yml의 포트. CI는 같은 값을 환경 변수로 넘긴다
          env: {
            DATABASE_URL: process.env.DATABASE_URL ?? "postgres://drive:drive@localhost:55432/drive_test",
            REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:56379/0",
            S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:58333",
          },
        },
      },
    ],
  },
});

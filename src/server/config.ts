import { z } from "zod";

const encryptionKey = z
  .string()
  .transform((value) => Buffer.from(value, "base64"))
  .refine((key) => key.length === 32, "base64로 인코딩한 32바이트 키여야 합니다");

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET_PRIMARY: z.string().min(1).default("drive-region-a"),
  S3_BUCKET_REPLICA: z.string().min(1).default("drive-region-b"),
  S3_BUCKET_COLD: z.string().min(1).default("drive-cold"),
  JWT_SECRET: z.string().min(32),
  BLOCK_ENCRYPTION_KEY: encryptionKey,
  LONG_POLL_TIMEOUT_MS: positiveInt(60_000),
  LONG_POLL_MAX_CONNECTIONS: positiveInt(10_000),
  UPLOAD_SESSION_TTL_HOURS: positiveInt(24),
  DELETED_RETENTION_DAYS: positiveInt(30),
  EVENT_RETENTION_DAYS: positiveInt(30),
  COLD_STORAGE_AFTER_DAYS: positiveInt(90),
  MAX_VERSIONS_PER_FILE: positiveInt(100),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`환경 변수 설정이 올바르지 않습니다\n${fields.join("\n")}`);
  }
  return result.data;
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= loadConfig(process.env);
  return cached;
}

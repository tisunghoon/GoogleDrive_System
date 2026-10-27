import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "@/server/config";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDatabase(url: string): { db: Database; close: () => Promise<void> } {
  const sql = postgres(url, { onnotice: () => {} });
  return { db: drizzle(sql, { schema }), close: () => sql.end() };
}

let shared: Database | undefined;

export function getDb(): Database {
  shared ??= createDatabase(getConfig().DATABASE_URL).db;
  return shared;
}

// Drizzle은 드라이버 오류를 DrizzleQueryError로 감싸 cause에 넣는다
export function pgErrorCode(error: unknown): string | undefined {
  let current = error;
  // cause가 순환해도 끝나도록 깊이를 제한한다
  for (let depth = 0; depth < 5; depth++) {
    if (!(current instanceof Object)) return undefined;
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === "string") return code;
    current = cause;
  }
  return undefined;
}

const RETRYABLE_CODES = new Set(["40001", "40P01"]); // serialization_failure, deadlock_detected

// work는 시도마다 다시 실행되므로 DB 쓰기만 담는다. 캐시 무효화와 이벤트 발행은 반환 후에 한다
export async function withTransaction<T>(
  db: Database,
  work: (tx: Transaction) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(work);
    } catch (error) {
      const code = pgErrorCode(error);
      if (attempt >= maxAttempts || code === undefined || !RETRYABLE_CODES.has(code)) throw error;
      // 같은 순서로 바로 다시 잠그면 교착이 반복되기 쉬워 잠깐 흩어 기다린다
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40));
    }
  }
}

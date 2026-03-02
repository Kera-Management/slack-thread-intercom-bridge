import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "../config/env.js";
import * as schema from "./schema.js";

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const env = getEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}

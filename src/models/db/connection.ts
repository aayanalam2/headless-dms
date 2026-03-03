import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../../config/env.ts";
import * as schema from "./schema.ts";

const queryClient = postgres(config.databaseUrl);

export const db = drizzle(queryClient, { schema, logger: config.nodeEnv === "development" });

export type Db = typeof db;

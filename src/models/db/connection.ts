import { config } from "../../config/env.ts";
import { createDb } from "../../infra/database/utils/connection.ts";
import type { AppDb } from "../../infra/database/utils/connection.ts";

// ---------------------------------------------------------------------------
// Singleton DB connection — shared across all repositories.
//
// We use the centralised createDb factory (infra layer) so that AppDb is the
// canonical type everywhere.  The old `Db` alias is kept for backward compat.
// ---------------------------------------------------------------------------

export const { db, sql } = createDb(config.databaseUrl);

/** @deprecated Use AppDb from @infra/database/utils/connection.ts instead. */
export type Db = AppDb;
export type { AppDb };

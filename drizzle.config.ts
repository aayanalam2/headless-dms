import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infra/database/schema.ts",
  out: "./src/infra/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"]!,
  },
} satisfies Config;

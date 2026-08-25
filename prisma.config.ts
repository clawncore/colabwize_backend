// Prisma 7+ configuration
import { defineConfig } from "@prisma/config";
import * as dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, ".env") });

// Use DIRECT_URL for migrations (avoids pgbouncer prepared statement issues)
const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL!;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl,
  },
});
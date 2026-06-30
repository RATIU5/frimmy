import path from "node:path";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
const env = loadEnv("test", __dirname, "");

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				bindings: {
					TEST_MIGRATIONS: migrations,
					TEST_USER: env.TEST_USER,
					ALLOWED_EMAILS: env.TEST_USER,
				},
			},
		}),
	],
});

import { existsSync, readFileSync } from "node:fs"
import { parseEnv } from "node:util"
import { defineConfig } from "vitest/config"

// Cheia si datele vehiculului vin din .env.e2e, ignorat de git.
const FISIER_ENV = ".env.e2e"
const env = existsSync(FISIER_ENV) ? parseEnv(readFileSync(FISIER_ENV, "utf8")) : {}

export default defineConfig({
	test: {
		include: ["e2e/**/*.e2e.test.ts"],
		env: env as Record<string, string>,
		// O verificare reala poate dura cateva minute.
		testTimeout: 6 * 60_000,
		hookTimeout: 60_000,
		// Secvential: nu vrem cereri paralele pe acelasi cont.
		fileParallelism: false,
	},
})

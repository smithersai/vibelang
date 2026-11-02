import { fileURLToPath } from "node:url"
import { checkErrorKeyMigration } from "../../error-key-migration.mjs"
checkErrorKeyMigration(fileURLToPath(new URL(".", import.meta.url)), false)

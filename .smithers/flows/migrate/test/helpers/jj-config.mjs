// Import this before a test creates jj fixture repositories. It points
// JJ_CONFIG at helpers/jj-config.toml for the whole test process, so every jj
// the test or the flow's lib spawns reads that file instead of the operator's
// user configuration. node --test runs each test file in its own process.
import { fileURLToPath } from "node:url"

export const jjConfig = fileURLToPath(new URL("./jj-config.toml", import.meta.url))
process.env.JJ_CONFIG = jjConfig

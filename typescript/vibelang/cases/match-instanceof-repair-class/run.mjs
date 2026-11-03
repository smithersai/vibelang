import { checkInstanceOfRepair } from "../../match-instanceof-check.mjs"
await checkInstanceOfRepair(import.meta.url, ["hit", "hit", "miss", "miss", "miss", "miss"], true)

import { checkInstanceOfRepair } from "../../match-instanceof-check.mjs"
await checkInstanceOfRepair(import.meta.url, ["miss", "hit", "miss", "hit", "miss", "miss"], false)

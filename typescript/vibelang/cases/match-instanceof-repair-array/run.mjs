import { checkInstanceOfParity } from "../../match-instanceof-check.mjs"
await checkInstanceOfParity(import.meta.url, ["hit", "hit", "miss", "miss", "miss"])

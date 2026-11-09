import { checkInstanceOfParity } from "../../match-instanceof-check.mjs"
await checkInstanceOfParity(import.meta.url, ["miss", "hit", "miss", "hit", "miss", "miss"])

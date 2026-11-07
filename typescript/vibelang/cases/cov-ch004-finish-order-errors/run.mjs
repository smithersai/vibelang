import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import { compare } from "../../test/cov-ch004-twin.mjs"
await compare(fileURLToPath(new URL(".", import.meta.url)), Effect, [["TypeError", "outer-close", "inner-close"], ["outer", "inner"], ["outer-close", "inner-close"], ["outer", "inner"]])

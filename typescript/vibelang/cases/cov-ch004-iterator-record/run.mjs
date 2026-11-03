import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import { compare } from "../../test/cov-ch004-twin.mjs"
await compare(fileURLToPath(new URL(".", import.meta.url)), Effect, [1, ["get next", "next 1", "next 2"]])

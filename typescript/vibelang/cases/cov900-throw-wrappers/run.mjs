import { fileURLToPath } from "node:url"
import { compareTwin } from "../../test/cov900-twin.mjs"
await compareTwin(fileURLToPath(new URL(".", import.meta.url)), ["callback", "BadJson", "UnknownError", "UnknownError", 4])

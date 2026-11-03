import { fileURLToPath } from "node:url"
import { compareTwin } from "../../test/cov900-twin.mjs"
await compareTwin(fileURLToPath(new URL(".", import.meta.url)), [6, 7, 6, 6, 3])

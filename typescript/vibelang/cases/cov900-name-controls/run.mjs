import { fileURLToPath } from "node:url"
import { compareTwin } from "../../test/cov900-twin.mjs"
await compareTwin(fileURLToPath(new URL(".", import.meta.url)), [2, 3, 6, 4, 5])

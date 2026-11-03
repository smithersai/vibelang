// run-seconds: 120
import {fileURLToPath} from "node:url"
import {compareTwin} from "../../test/cov900-twin.mjs"
await compareTwin(fileURLToPath(new URL(".",import.meta.url)),["UnknownError:executor","UnknownError:thunk"])

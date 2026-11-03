// run-seconds: 120
import {fileURLToPath} from "node:url"
import {compareTwin} from "../../test/cov900-twin.mjs"
await compareTwin(fileURLToPath(new URL(".",import.meta.url)),[7,2,"Error:missing","Error:missing","Error:missing",true])

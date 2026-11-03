import {checkTwin} from "../../test/coverage-twin.mjs"
import {fileURLToPath} from "node:url"
checkTwin(fileURLToPath(new URL(".",import.meta.url)))
console.log("twin types and Exit agree")

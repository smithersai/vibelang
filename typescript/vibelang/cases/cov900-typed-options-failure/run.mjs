// run-seconds: 120
import {fileURLToPath} from "node:url"
import {compareTwin} from "../../test/cov900-twin.mjs"
await compareTwin(fileURLToPath(new URL(".",import.meta.url)), {"_id": "Exit", "_tag": "Failure", "cause": {"_id": "Cause", "reasons": [{"_tag": "Fail", "error": {"cause": "invalid", "_tag": "BadJson"}}]}}, "Failure")

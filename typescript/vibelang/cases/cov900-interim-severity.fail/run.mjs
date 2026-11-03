// run-seconds: 1440
import {fileURLToPath} from "node:url"
import {runInterimSeverityMutations} from "../../test/cov900-probe.mjs"
runInterimSeverityMutations(fileURLToPath(new URL(".",import.meta.url)))

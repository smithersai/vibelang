// run-seconds: 360
import {fileURLToPath} from "node:url"
import {readFileSync} from "node:fs"
import {runProbes} from "../../test/cov900-probe.mjs"
runProbes(fileURLToPath(new URL(".",import.meta.url)),JSON.parse(readFileSync(new URL("probes.json",import.meta.url),"utf8")))

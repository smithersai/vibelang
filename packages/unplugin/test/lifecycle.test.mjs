import { unplugin } from "../src/index.js"
import { lifecycleTests } from "../../compiler/test/bundler-lifecycle.mjs"
lifecycleTests(options => unplugin.raw(options, { framework: "rollup" }))

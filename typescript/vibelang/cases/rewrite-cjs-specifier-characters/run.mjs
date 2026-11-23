// Loads the CommonJS output with require, as a CommonJS consumer would.
import { createRequire } from "node:module"
import { Effect } from "effect"

const require = createRequire(import.meta.url)
const { program } = require("./out/main.js")
console.log(JSON.stringify(await Effect.runPromise(program())))

// Discover top-level Node tests without executing their bodies or hooks.
// A selected top-level test carries its subtests into the same owner.
import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
globalThis.__vibelangTestNames = []
const stub = [
'const register = name => { if (typeof name !== "string") throw new Error("test inventory requires named tests"); globalThis.__vibelangTestNames.push(name); return Promise.resolve() }',
'register.only = register; register.skip = register; register.todo = register;',
'export { register as test, register as it, register as describe, register as suite };',
'export default register;',
'export const before = () => {}, after = () => {}, beforeEach = () => {}, afterEach = () => {};'
].join("\n")
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "node:test") return { url: "data:text/javascript," + encodeURIComponent(stub), shortCircuit: true }
    return next(specifier, context)
  }
})
await import(pathToFileURL(resolve(process.argv[2])).href)
console.log("NODE_TEST_NAMES " + JSON.stringify(globalThis.__vibelangTestNames))

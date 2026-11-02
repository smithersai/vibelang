import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { probe, nativeSource } from "./out/main.js"
const ts = createRequire(import.meta.resolve("effect"))("typescript")
const native = new Function(ts.transpileModule(nativeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + "\nreturn probe")()
assert.deepEqual(probe(), native())
console.log("ok")

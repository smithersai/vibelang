// With effectGlobals and effectModules both false, a .vibe module writes the
// explicit Effect import its .ts twin needs: the spec's example prints 42
// under the compiler and under stock TypeScript, and dropping the import is
// TypeScript's TS2304 in both. With the default switches the import-free
// module compiles, so the switches are what require the import.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

// The module exports the example's value; a driver prints it.
const example = 'import { Effect } from "effect"\nexport const result = Effect.runSync(Effect.succeed(42)) // 42\n'
const bare = "export const result = Effect.runSync(Effect.succeed(42))\n"
const show = (run, file) => run(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify("./" + file)}).then(m => console.log(m.result))`]).stdout
const off = { effectGlobals: false, effectModules: false }
const printed = text => [...text.matchAll(/^(\S+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm)].map(m => [m[2], m[3], m[4], m[5]].join(" "))

const build = (source, vibe) => project(({ put, invoke, stock, run, exists }) => {
  put("main.vibe", source)
  put("tsconfig.json", { compilerOptions: baseOptions(), files: ["main.vibe"], ...(vibe ? { vibe } : {}) })
  const v = invoke("-p", ".", "--pretty", "false")
  const vout = v.status === 0 && exists("out/main.js") ? show(run, "out/main.js") : null
  put("twin/main.ts", source)
  put("twin/tsconfig.json", { compilerOptions: baseOptions(), files: ["main.ts"] })
  put("twin/package.json", '{"type":"module"}')
  const s = stock("-p", "twin", "--pretty", "false")
  const sout = s.status === 0 ? show(run, "twin/out/main.js") : null
  return { v, s, vout, sout }
})

// The example: no diagnostics, and both programs print 42.
const ok = build(example, off)
assert.equal(ok.v.status, 0, ok.v.text)
assert.equal(ok.s.status, 0, ok.s.text)
assert.equal(ok.vout, "42\n")
assert.equal(ok.sout, "42\n")

// Without the import: the same TypeScript diagnostics at the same places.
const missing = build(bare, off)
assert.notEqual(missing.v.status, 0)
assert.deepEqual(printed(missing.v.text), ["1 23 TS2304 Cannot find name 'Effect'.", "1 38 TS2304 Cannot find name 'Effect'."], missing.v.text)
assert.deepEqual(printed(missing.v.text), printed(missing.s.text), missing.s.text)

// With the defaults the import-free module runs; effectModules: false alone
// already removes the Effect module (TypeScript then suggests the isEffect
// global, TS2552).
const defaults = build(bare, undefined)
assert.equal(defaults.v.status, 0, defaults.v.text)
assert.equal(defaults.vout, "42\n")
const modulesOff = build(bare, { effectModules: false })
assert.deepEqual(printed(modulesOff.v.text).map(d => d.split(" ").slice(2).join(" ")), ["TS2552 Cannot find name 'Effect'. Did you mean 'isEffect'?", "TS2552 Cannot find name 'Effect'. Did you mean 'isEffect'?"], modulesOff.v.text)
console.log("both prelude switches false: explicit imports print 42 as the .ts twin does; omitted imports report TS2304")

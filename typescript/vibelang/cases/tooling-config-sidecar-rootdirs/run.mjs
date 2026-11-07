// "sidecarDir": ".vibe/declarations" with "rootDir": "." mirrors src/user.vibe
// to .vibe/declarations/src/user.d.vibe.ts, and stock TypeScript checks a
// consumer of ./user.vibe through it once rootDirs pairs "." with that
// directory. Without the pair, or with a pair that does not mirror the
// layout, stock tsc cannot find the module.
import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

const lines = text => text.trim().split("\n").filter(Boolean)
project(({ put, read, exists, invoke, stock }) => {
  put("src/user.vibe", "export const user = 1\nexport function greet(name: string): string { return \"hi \" + name }\n")
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), rootDir: "." }, include: ["src"], vibe: { sidecarDir: ".vibe/declarations" } })
  const build = invoke("-p", ".", "--pretty", "false")
  assert.equal(build.status, 0, build.text)
  assert.ok(exists(".vibe/declarations/src/user.d.vibe.ts"))
  assert.ok(!exists("src/user.d.vibe.ts"), "the sidecar moved out of src")
  assert.match(read(".vibe/declarations/src/user.d.vibe.ts"), /export declare function greet\(name: string\): string;/)

  // A native consumer in src imports the VibeLang module by its source name.
  put("src/consumer.ts", 'import { user, greet } from "./user.vibe"\nexport const n: number = user\nexport const s: string = greet("x")\nexport const bad: string = user\n')
  const check = rootDirs => {
    const compilerOptions = { ...baseOptions(), noEmit: true, allowArbitraryExtensions: true }
    if (rootDirs) compilerOptions.rootDirs = rootDirs
    put("tsconfig.stock.json", { compilerOptions, files: ["src/consumer.ts"] })
    return stock("-p", "tsconfig.stock.json", "--pretty", "false")
  }
  // With the pair, the sidecar's types reach the consumer: only the
  // deliberate mismatch is reported.
  const paired = check([".", ".vibe/declarations"])
  assert.deepEqual(lines(paired.text), ["src/consumer.ts(4,14): error TS2322: Type 'number' is not assignable to type 'string'."])
  // The order of the pair does not matter to rootDirs.
  assert.deepEqual(lines(check([".vibe/declarations", "."]).text), lines(paired.text))
  // Without rootDirs, or paired with the wrong directory, the module is missing.
  for (const rootDirs of [undefined, [".", ".vibe"], ["src", ".vibe/declarations"]]) {
    const r = check(rootDirs)
    assert.deepEqual(diagnostics(r.text), ["error TS2307"], JSON.stringify(rootDirs) + "\n" + r.text)
  }
})
console.log("stock tsc resolves ./user.vibe through .vibe/declarations only with the rootDirs pair")

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const names = ["vibe.config.json", "tsconfig.json", "jsconfig.json"]
const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), "chapter007-config-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "main.ts"), "export const value = 1")
  return root
}
const put = (root, file, object) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), typeof object === "string" ? object : JSON.stringify(object))
}
const show = (root, args) => {
  const result = spawnSync(binary, [...args, "--showConfig"], { cwd: root, encoding: "utf8", timeout: 20000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}

// Chapter 007 / explicit project-file selection: docs/design/src/007-tooling.md#f73d1b24c8c4d9c5
test("Chapter 007 / explicit project file wins beside a preferred config", t => {
  const root = fixture(t)
  put(root, names[0], { compilerOptions: { strict: false }, files: ["main.ts"] })
  put(root, "chosen.json", { compilerOptions: { strict: true }, files: ["main.ts"] })
  assert.equal(show(root, ["-p", "chosen.json"]).compilerOptions.strict, true)
  assert.equal(show(root, ["-p", "."]).compilerOptions.strict, false)
})

// Chapter 007 / TypeScript option/default parity: docs/design/src/007-tooling.md#2831d9b13dc39f4c
// Chapter 007 / modern options in all three config formats: docs/design/src/007-tooling.md#1820f5b709fab62d
for (const name of names) {
  test("Chapter 007 / native fields and modern options in " + name, t => {
    const root = fixture(t)
    const config = { compilerOptions: { strict: true, target: "es2022" }, vibe: { effectGlobals: false, effectModules: false }, files: ["main.ts"] }
    put(root, name, config)
    const native = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, join(root, name))
    const actual = show(root, ["-p", name])
    assert.equal(actual.compilerOptions.strict, native.options.strict)
    assert.equal(actual.compilerOptions.target, "es2022")
    assert.equal(Boolean(actual.compilerOptions.allowJs), Boolean(native.options.allowJs))
    assert.deepEqual(actual.vibe, config.vibe)
  })
}

// Chapter 007 / stock tsc custom option placement: docs/design/src/007-tooling.md#d2a1869ef7b6d69d
// Chapter 007 / stock tsc rejects compilerOptions.vibelang: docs/design/src/007-tooling.md#36fba1e65a016465
test("Chapter 007 / stock tsc accepts custom root keys and rejects custom compiler options", () => {
  for (const name of names) {
    const parse = config => ts.parseJsonConfigFileContent({ ...config, files: ["main.ts"] }, ts.sys, "/", undefined, "/" + name)
    assert.deepEqual(parse({ vibe: { effectGlobals: false }, vibelang: {} }).errors, [])
    for (const key of ["vibelang", "unknownOption"]) {
      assert.deepEqual(parse({ compilerOptions: { [key]: {} } }).errors.map(d => d.code), [5023])
    }
  }
})

// Chapter 007 / legacy root and nested config paths through extends: docs/design/src/007-tooling.md#08740b402d374195
for (const name of names) {
  for (const nested of [false, true]) {
    test("Chapter 007 / legacy paths in extended " + name + ", nested=" + nested, t => {
      const root = fixture(t)
      const legacy = { diagnostics: { EK4802: "off" } }
      const base = nested ? { compilerOptions: { vibelang: legacy } } : { vibelang: legacy }
      put(root, "base.json", base)
      put(root, name, { extends: "./base.json", files: ["main.ts"] })
      const actual = show(root, ["-p", name])
      assert.equal(actual.compilerOptions.vibelang.diagnostics.EK4802, "off")
    })
  }
}

// Chapter 007 / legacy map admits only its three categories: docs/design/src/007-tooling.md#30e825af1d4af8be
// Chapter 007 / modern-only warning codes stay invalid in legacy maps: docs/design/src/007-tooling.md#8ebcab313e276eec
test("Chapter 007 / legacy severity values stay distinct from modern severities", t => {
  const root = fixture(t)
  for (const severity of ["error", "warning", "off"]) {
    put(root, "tsconfig.json", { vibelang: { diagnostics: { EK4802: severity } }, files: ["main.ts"] })
    assert.equal(show(root, ["-p", "."]).compilerOptions.vibelang.diagnostics.EK4802, severity)
  }
  for (const [code, value] of [["EK4802", "suggestion"], ["EK0801", "off"]]) {
    put(root, "tsconfig.json", { vibelang: { diagnostics: { [code]: value } }, files: ["main.ts"] })
    const result = spawnSync(binary, ["-p", ".", "--showConfig"], { cwd: root, encoding: "utf8", timeout: 20000 })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /(?:TS6046|TS5023)/)
  }
})

// Chapter 007 / hiding EK3009 retains legacy validation and settings: docs/design/src/007-tooling.md#24f70fbdee51e20e
test("Chapter 007 / EK3009 off hides no independent legacy validation",t=>{
 const root=fixture(t)
 const config=value=>({files:["main.ts"],compilerOptions:{noEmit:true,types:[]},vibelang:{diagnostics:{EK4802:value}},vibe:{severities:{EK3009:"off"}}})
 put(root,"tsconfig.json",config("off"))
 assert.equal(show(root,["-p","."]).compilerOptions.vibelang.diagnostics.EK4802,"off")
 const checked=spawnSync(binary,["-p",".","--pretty","false"],{cwd:root,encoding:"utf8",timeout:20000})
 assert.equal(checked.status,0,checked.stdout+checked.stderr)
 assert.doesNotMatch(checked.stdout+checked.stderr,/EK3009/)
 put(root,"tsconfig.json",config("suggestion"))
 const invalid=spawnSync(binary,["-p",".","--pretty","false"],{cwd:root,encoding:"utf8",timeout:20000})
 assert.notEqual(invalid.status,0)
 assert.match(invalid.stdout+invalid.stderr,/TS6046/)
 assert.doesNotMatch(invalid.stdout+invalid.stderr,/EK3009/)
})

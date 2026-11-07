// run-seconds: 180
// The prelude switches vibe.effectGlobals and vibe.effectModules: defaults,
// each switch off, both off with explicit imports, and where the keys live.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { Effect } from "effect"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const modules = fileURLToPath(new URL("./node_modules", import.meta.url))
const roots = []
const compilerOptions = {
  target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], lib: ["esnext"],
  skipLibCheck: true, outDir: "out"
}
const sources = {
  // An Effect function as a bare global.
  "globals.vibe": "export const viaGlobal = succeed(1)\n",
  // Effect modules used without an import, including the qualified Effect.sleep.
  "modules.vibe": "export const viaModule = Effect.succeed(2)\nexport const nap = Effect.sleep(\"1 millis\")\nexport const millis = Duration.toMillis(Duration.seconds(1))\n",
  // The same modules imported explicitly, as in TypeScript.
  "imported.vibe": "import { Duration, Effect } from \"effect\"\nexport const imported = Effect.succeed(Duration.toMillis(Duration.seconds(2)))\n"
}

function compile(file, shape) {
  const root = mkdtempSync(join(tmpdir(), "w02-prelude-"))
  roots.push(root)
  symlinkSync(modules, join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, file), sources[file])
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions, files: [file], ...shape }))
  const run = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 120000 })
  const codes = [...run.stdout.matchAll(/^(\S+)\((\d+),(\d+)\): (error|warning) ((?:EK|TS)\d+)/gm)]
    .map(m => `${m[1]}(${m[2]},${m[3]}) ${m[4]} ${m[5]}`)
  assert.equal(run.status, codes.some(c => c.includes(" error ")) ? 2 : 0, run.stdout)
  return { root, codes }
}
const load = async (root, file) => import(pathToFileURL(join(root, "out", file.replace(/\.vibe$/, ".js"))).href)
const show = codes => codes.length ? codes.join(", ") : "clean"

try {
  // Defaults: no vibe object, an empty one and explicit true values agree.
  for (const [label, shape] of [["no vibe object", {}], ["vibe {}", { vibe: {} }], ["both true", { vibe: { effectGlobals: true, effectModules: true } }]]) {
    for (const file of Object.keys(sources)) assert.deepEqual(compile(file, shape).codes, [], `${label}: ${file}`)
    console.log(`${label}: globals.vibe, modules.vibe and imported.vibe compile clean`)
  }
  const globals = compile("globals.vibe", {}), modulesRun = compile("modules.vibe", {})
  const g = await load(globals.root, "globals.vibe"), m = await load(modulesRun.root, "modules.vibe")
  const values = [Effect.runSync(g.viaGlobal), Effect.runSync(m.viaModule), await Effect.runPromise(m.nap), m.millis]
  assert.deepEqual(values, [1, 2, undefined, 1000])
  console.log("default run: succeed(1) = 1, Effect.succeed(2) = 2, Effect.sleep runs, Duration.toMillis = 1000")

  // effectGlobals: false turns the bare functions off; qualified calls stay.
  const noGlobals = { vibe: { effectGlobals: false } }
  assert.deepEqual(compile("globals.vibe", noGlobals).codes, ["globals.vibe(1,26) error TS2304"])
  const qualified = compile("modules.vibe", noGlobals)
  assert.deepEqual(qualified.codes, [])
  const q = await load(qualified.root, "modules.vibe")
  assert.deepEqual([Effect.runSync(q.viaModule), await Effect.runPromise(q.nap), q.millis], [2, undefined, 1000])
  console.log("effectGlobals false: succeed is TS2304; Effect.succeed, Effect.sleep and Duration compile and run")

  // effectModules: false removes the module names and requires imports;
  // the function globals are a separate switch.
  const noModules = { vibe: { effectModules: false } }
  const unimported = compile("modules.vibe", noModules).codes
  assert.deepEqual(unimported.map(c => c.replace(/TS2552/, "TS2304")), [
    "modules.vibe(1,26) error TS2304", "modules.vibe(2,20) error TS2304", "modules.vibe(3,23) error TS2304", "modules.vibe(3,41) error TS2304"
  ])
  assert.deepEqual(compile("globals.vibe", noModules).codes, [])
  const withImports = compile("imported.vibe", noModules)
  assert.deepEqual(withImports.codes, [])
  assert.equal(Effect.runSync((await load(withImports.root, "imported.vibe")).imported), 2000)
  console.log("effectModules false: unimported Effect and Duration are unresolved (" + unimported.length + " sites); succeed stays; imports compile and run")

  // Both off: TypeScript's explicit imports.
  const neither = { vibe: { effectGlobals: false, effectModules: false } }
  assert.deepEqual(compile("globals.vibe", neither).codes, ["globals.vibe(1,26) error TS2304"])
  assert.equal(compile("modules.vibe", neither).codes.length, 4)
  const explicit = compile("imported.vibe", neither)
  assert.deepEqual(explicit.codes, [])
  assert.equal(Effect.runSync((await load(explicit.root, "imported.vibe")).imported), 2000)
  console.log("both false: bare and unimported names are unresolved; explicit imports compile and run")

  // The settings live in the root vibe object; elsewhere they do nothing.
  const placements = {
    "root effectGlobals": { effectGlobals: false },
    "compilerOptions.effectGlobals": { compilerOptions: { ...compilerOptions, effectGlobals: false } },
    "vibelang.effectGlobals": { vibelang: { effectGlobals: false } }
  }
  for (const [label, shape] of Object.entries(placements)) {
    const codes = compile("globals.vibe", shape).codes
    assert.ok(!codes.some(c => c.startsWith("globals.vibe")), `${label} leaves the globals on: ${codes}`)
    console.log(`${label} false: succeed still resolves; config diagnostics: ${show(codes.map(c => c.replace(/\(\d+,\d+\)/, "")))}`)
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}

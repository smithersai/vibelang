// run-seconds: 300
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { Effect } from "effect"
import { main } from "./out/main.js"
const reference = mkdtempSync(join(tmpdir(), "vip38-stock-twin-"))
try {
  mkdirSync(join(reference, "node_modules"))
  let effect410 = process.env.EFFECT_410_NODE_MODULES ? join(process.env.EFFECT_410_NODE_MODULES, "effect") : new URL("../../../.cache/effect-4.1.0/node_modules/effect", import.meta.url).pathname
  if (!existsSync(join(effect410, "package.json")) && !process.env.EFFECT_410_NODE_MODULES) {
    const install = spawnSync("npm", ["install", "--prefix", reference, "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", "--package-lock=false", "effect@4.1.0"], { cwd: reference, encoding: "utf8", timeout: 90000 })
    assert.ifError(install.error)
    assert.equal(install.status, 0, "stock Effect install: " + install.stdout + install.stderr)
    effect410 = join(reference, "node_modules/effect")
  }
  assert.equal(JSON.parse(readFileSync(join(effect410, "package.json"), "utf8")).version, "4.1.0")
  if (effect410 !== join(reference, "node_modules/effect")) symlinkSync(effect410, join(reference, "node_modules/effect"))
  writeFileSync(join(reference, "package.json"), '{"type":"module"}')
  writeFileSync(join(reference, "main.ts"), readFileSync(new URL("./typescript/main.ts", import.meta.url), "utf8"))
  const stock = new URL("../../../../docs/tools/node_modules/typescript/bin/tsc", import.meta.url).pathname
  const checked = spawnSync(process.execPath, [stock, "--target", "ES2022", "--module", "NodeNext", "--strict", "--skipLibCheck", "--declaration", "--outDir", "out", "main.ts"], { cwd: reference, encoding: "utf8", timeout: 30000 })
  assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  assert.equal(readFileSync(join(reference, "out/main.d.ts"), "utf8"), readFileSync(new URL("./out/main.d.ts", import.meta.url), "utf8"))
  const NativeEffect = await import(pathToFileURL(createRequire(join(reference, "probe.cjs")).resolve("effect/Effect")).href)
  const native = await import(pathToFileURL(join(reference, "out/main.js")).href)
  assert.deepEqual(JSON.parse(JSON.stringify(await Effect.runPromiseExit(main()))), JSON.parse(JSON.stringify(await NativeEffect.runPromiseExit(native.main()))))
  console.error(JSON.stringify({ stage: "stock-twin", typescript: "5.9.3", effect: "4.1.0", types: "equal", exit: "equal" }))
} finally { rmSync(reference, { recursive: true, force: true }) }

const dir = mkdtempSync(join(tmpdir(), "vip38-mixed-"))
try {
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
  symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  const sources = {
    "native.ts": 'import { Effect } from "effect"; export function example() { return Effect.gen(function* () { Effect.succeed(1); Effect.gen(function* () { return 99 }); return 2 }) }',
    "main.vibe": 'import { Effect } from "effect"; export effect function example() { Effect.succeed(1); effect { return 99 }; return 2 }'
  }
  for (const [name, source] of Object.entries(sources)) writeFileSync(join(dir, name), source)
  const plugin = diagnosticSeverity => ({ name: "@effect/language-service", diagnosticSeverity })
  const issues = []
  for (const [name, plugins, severities, category] of [
    ["default", [plugin({})], {}, "error"],
    ["plugin-warning", [plugin({ floatingEffect: "warning" })], {}, "warning"],
    ["modern-off", [plugin({ floatingEffect: "error" })], { EK3801: "off" }, undefined],
    ["modern-error", [plugin({ floatingEffect: "warning" })], { EK3801: "error" }, "error"],
    ["modern-warning", [plugin({ floatingEffect: "error" })], { EK3801: "warning" }, "warning"],
    ["modern-suggestion", [plugin({ floatingEffect: "error" })], { EK3801: "suggestion" }, "suggestion"]
  ]) {
    try {
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      strict: true, types: [], skipLibCheck: true, noEmit: true, target: "ES2022", module: "NodeNext", plugins
    }, files: ["native.ts", "main.vibe"], vibe: { effectGlobals: false, effectModules: false, severities } }))
    const r = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 15000 })
    assert.equal(r.error, undefined, String(r.error))
    const output = r.stdout + r.stderr
    assert.equal(r.status === 0, category !== "error", name + "\n" + output)
    const observed = [...output.matchAll(/(native\.ts|main\.vibe)\(\d+,\d+\): (error|warning|suggestion) EK3801: floatingEffect:/g)].map(([, file, severity]) => [file, severity])
    // CLI may omit suggestion presentation, as ordinary TypeScript does; the
    // API oracle separately checks the stored category. Error/warning/off must
    // be observable in both selected source kinds.
    if (category !== "suggestion") assert.deepEqual(observed.sort(), category ? [["main.vibe", category], ["main.vibe", category], ["native.ts", category], ["native.ts", category]] : [], name + "\n" + output)
    assert.doesNotMatch(output, /TS\d+|EK(?!3801\b)\d+/, name + "\n" + output)
    } catch (error) { issues.push(new Error(name + ": " + error.message)) }
  }
  // Native activation is explicit, not an automatic opt-in from project membership.
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, types: [], skipLibCheck: true, noEmit: true, target: "ES2022", module: "NodeNext"
  }, files: ["native.ts"], vibe: { severities: { EK0801: "off" } } }))
  const absent = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 15000 })
  assert.equal(absent.error, undefined)
  assert.equal(absent.status, 0, absent.stdout + absent.stderr)
  assert.doesNotMatch(absent.stdout + absent.stderr, /EK38\d+/)
  if (issues.length) throw new AggregateError(issues, "VIP-38 mixed-input matrix")
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log("mixed lint inputs")

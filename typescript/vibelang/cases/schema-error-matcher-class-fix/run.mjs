// run-seconds: 270
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const root = path.join(here, ".cache", "class-upgrades-" + process.pid)
fs.mkdirSync(root, { recursive: true })
const variants = [
  { name: "Gone", prefix: "", extras: "[]", expected: [], flags: [] },
  { name: "Gone", prefix: "const $schemaErrorMatcher = 0; const $ErrorMatcher = 1; const $ErrorMatcher2 = 2;", extras: "[$schemaErrorMatcher, $ErrorMatcher, $ErrorMatcher2]", expected: [0, 1, 2], flags: ["--fix-migration-only"] },
  { name: "GoneΩ", prefix: "", extras: "[]", expected: [], flags: ["--fix-vip-only"] },
  { name: "Gone", prefix: "", extras: "[]", expected: [], flags: [], extra: true }
]
for (const [index, variant] of variants.entries()) {
  const dir = path.join(root, String(index))
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n')
  const name = variant.name
  const tag = JSON.stringify(name)
  const source = [
    'import { customMatcher } from "vibelang-runtime"',
    variant.prefix,
    "export schema error " + name + " {",
    "  id: string",
    "  static marker = 1",
    "  static observed: boolean = match ({ _tag: " + tag + " } as unknown) { when " + name + ": true; default: false; }",
    "}",
    ...(variant.extra ? [
      "export schema error OtherGone {",
      "  id: string; static marker = 2",
      "  static observed: boolean = match ({ _tag: \"OtherGone\" } as unknown) { when OtherGone: true; default: false; }",
      "}"
    ] : []),
    "export function probe(): unknown[] {",
    "  const subjects: unknown[] = [{ _tag: " + tag + ' }, { _tag: "Different" }]',
    "  const copied = Reflect.get(" + name + ", customMatcher)",
    "  return [" + name + ".marker, " + name + ".observed,",
    "    subjects.map((subject) => match (subject) { when " + name + "(let error): error === subject; default: false; }),",
    '    typeof copied === "function" && copied(subjects[0], { matchType: "boolean" })[0] === subjects[0],',
    "    " + variant.extras + ",",
    "    " + (variant.extra ? "[OtherGone.marker, OtherGone.observed, match ({ _tag: \"OtherGone\" } as unknown) { when OtherGone: true; default: false; }]" : "[]") + "]",
    "}", ""
  ].join("\n")
  fs.writeFileSync(path.join(dir, "main.vibe"), source)
  const config = { compilerOptions: { target: "es2022", module: "nodenext", strict: true, skipLibCheck: true, types: [], declaration: true, noEmitOnError: false, outDir: "before" }, include: ["main.vibe"] }
  const compile = (flags = []) => {
    const r = spawnSync(compiler, ["-p", dir, "--pretty", "false", ...flags], { encoding: "utf8", timeout: 20000 })
    assert.equal(r.error, undefined, r.error?.message)
    return { status: r.status, text: (r.stdout ?? "") + (r.stderr ?? "") }
  }
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config))
  const before = compile()
  assert.equal(before.status, 2, before.text)
  assert.equal((before.text.match(/error EK1302:/g) ?? []).length, variant.extra ? 4 : 2, before.text)
  assert.equal((before.text.match(/error (?:TS|EK)\d+:/g) ?? []).length, variant.extra ? 4 : 2, before.text)
  const baseline = (await import(pathToFileURL(path.join(dir, "before", "main.js")))).probe()
  assert.deepEqual(baseline, [1, true, [true, false], true, variant.expected, variant.extra ? [2, true, true] : []])
  const declarations = fs.readFileSync(path.join(dir, "before", "main.d.ts"), "utf8")
  config.compilerOptions.outDir = "after"
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config))
  const fixed = compile(["--fix", ...variant.flags])
  assert.equal(fixed.status, 0, fixed.text)
  const observed = (await import(pathToFileURL(path.join(dir, "after", "main.js")))).probe()
  assert.deepEqual(observed, baseline, JSON.stringify({ variant: index, stage: "fixed runtime" }))
  assert.equal(fs.readFileSync(path.join(dir, "after", "main.d.ts"), "utf8"), declarations)
  const text = fs.readFileSync(path.join(dir, "main.vibe"), "utf8")
  const repeated = compile(["--fix", ...variant.flags])
  assert.equal(repeated.status, 0, repeated.text)
  assert.equal(fs.readFileSync(path.join(dir, "main.vibe"), "utf8"), text)
}
fs.rmSync(root, { recursive: true })
console.log("schema error class upgrades retain tags, initialization, declarations and fresh names")

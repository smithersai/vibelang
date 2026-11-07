// run-seconds: 120
// The retired trustedPackages key warns with EK3010 in every supported section
// and for every value, keeps the exit status and output, and trusts nothing.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const effect = fileURLToPath(new URL("./node_modules/effect", import.meta.url))
const roots = []

const compilerOptions = {
  target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true,
  types: [], lib: ["esnext"], skipLibCheck: true, declaration: true, noEmitOnError: true, outDir: "out"
}
const bridged = `import { data } from "@x/twin"
export effect function bridged() {
  return try Effect.try(() => data())
}
`
const direct = `import { data } from "@x/twin"
export effect function direct() {
  return data()
}
`

function project(config, source, name = "tsconfig.json") {
  const root = mkdtempSync(join(tmpdir(), "w02-trusted-"))
  roots.push(root)
  const files = {
    "package.json": '{"type":"module"}\n',
    "main.vibe": source,
    "node_modules/@x/twin/package.json": '{"name":"@x/twin","type":"module","types":"index.d.ts","main":"index.js"}\n',
    "node_modules/@x/twin/index.d.ts": "export declare function data(): number\n",
    "node_modules/@x/twin/index.js": "export function data() { return 42 }\n",
    [name]: JSON.stringify(config)
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  symlinkSync(effect, join(root, "node_modules/effect"), "dir")
  return root
}

function compile(root, name = "tsconfig.json") {
  const run = spawnSync(binary, ["-p", name, "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 120000 })
  const diagnostics = [...run.stdout.matchAll(/^(\S+)\((\d+),(\d+)\): (error|warning) ((?:EK|TS)\d+)/gm)]
    .map(m => ({ file: m[1], column: Number(m[3]), category: m[4], code: m[5] }))
  return { status: run.status, stdout: run.stdout + run.stderr, diagnostics }
}

const read = (root, file) => readFileSync(join(root, file), "utf8")

try {
  // Baseline: without the key, the bridged program compiles cleanly.
  const base = project({ compilerOptions, files: ["main.vibe"] }, bridged)
  const baseRun = compile(base)
  assert.equal(baseRun.status, 0, baseRun.stdout)
  assert.deepEqual(baseRun.diagnostics, [], baseRun.stdout)
  const baseJs = read(base, "out/main.js"), baseDts = read(base, "out/main.d.ts")
  console.log("without the key: no diagnostics, exit 0")

  const values = [["@x/*"], ["@x/twin"], 42, null, "bad", true, {}, []]
  const sections = {
    "vibe": value => ({ compilerOptions, files: ["main.vibe"], vibe: { trustedPackages: value } }),
    "vibelang": value => ({ compilerOptions, files: ["main.vibe"], vibelang: { trustedPackages: value } }),
    "compilerOptions.vibelang": value => ({ compilerOptions: { ...compilerOptions, vibelang: { trustedPackages: value } }, files: ["main.vibe"] })
  }
  for (const [section, make] of Object.entries(sections)) {
    for (const value of values) {
      const config = make(value)
      const root = project(config, bridged)
      const result = compile(root)
      const key = JSON.stringify(config).indexOf('"trustedPackages"') + 1
      assert.deepEqual(result.diagnostics, [{ file: "tsconfig.json", column: key, category: "warning", code: "EK3010" }],
        `${section} = ${JSON.stringify(value)}\n${result.stdout}`)
      assert.equal(result.status, 0, `the warning does not fail the compile: ${section}\n${result.stdout}`)
      assert.equal(read(root, "out/main.js"), baseJs, `JavaScript unchanged: ${section}`)
      assert.equal(read(root, "out/main.d.ts"), baseDts, `declarations unchanged: ${section}`)
    }
    console.log(`${section}.trustedPackages: one EK3010 warning at the key for ${values.length} values, exit 0, output unchanged`)
  }

  // The same in vibe.config.json, the first discovered config name.
  const vibeConfig = { compilerOptions, files: ["main.vibe"], vibe: { trustedPackages: ["@x/*"] } }
  const viaVibeConfig = project(vibeConfig, bridged, "vibe.config.json")
  const vibeConfigRun = compile(viaVibeConfig, "vibe.config.json")
  assert.deepEqual(vibeConfigRun.diagnostics.map(d => `${d.file} ${d.category} ${d.code}`), ["vibe.config.json warning EK3010"], vibeConfigRun.stdout)
  assert.equal(vibeConfigRun.status, 0, vibeConfigRun.stdout)
  console.log("vibe.config.json vibe.trustedPackages: EK3010 warning, exit 0")

  // Ignored means no trust: an unbridged npm call in effect code is EK0403
  // with or without the key, at the same site.
  const directCodes = config => {
    const result = compile(project(config, direct))
    assert.equal(result.status, 1, `EK0403 fails the compile under noEmitOnError\n${result.stdout}`)
    return result.diagnostics.map(d => `${d.file}(${d.column}) ${d.category} ${d.code}`)
  }
  const untrusted = directCodes({ compilerOptions, files: ["main.vibe"] })
  assert.deepEqual(untrusted, ["main.vibe(10) error EK0403"])
  for (const [section, make] of Object.entries(sections)) {
    const codes = directCodes(make(["@x/*"]))
    assert.deepEqual(codes.filter(c => !c.startsWith("tsconfig.json")), untrusted, section)
    assert.deepEqual(codes.filter(c => c.startsWith("tsconfig.json")).map(c => c.replace(/\(\d+\)/, "")), ["tsconfig.json warning EK3010"], section)
  }
  console.log("direct npm call in effect code: EK0403 with and without trustedPackages in each section")
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}

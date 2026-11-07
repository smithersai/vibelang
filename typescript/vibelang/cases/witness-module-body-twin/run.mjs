// rule-evidence: docs/design/src/001-functions.md#module-declarations | Its body is a TypeScript file stored in the `.vibe` file: moving it to a sibling `.ts` file (`.tsx` for a body in `.vibex`) with its external-module classification preserved and replacing `from name` with that file's specifier changes no diagnostic, type, emitted statement, declaration or run-time observation.
// rule-evidence: docs/design/src/001-functions.md#module-declarations | A body is an external module before binding and checking, even without written imports or exports and regardless of `moduleDetection`.
//
// Each project is compiled with its module body inline and again with the body
// moved to parse.ts (parse.tsx for main.vibex), with export {} appended when
// the body has no import or export. Diagnostics, the body's JavaScript and
// declarations, and what the program does must not change.
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const dir = fileURLToPath(new URL(".", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const rule = (s) => s.replace(/^\n/, "")

// A body that throws, carries a native type error and is a module by its exports.
const exported = rule(`
/** @throws {RangeError} */
export function port(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new RangeError(\`bad port: \${raw}\`)
  return n
}
export const wrong: number = "not a number"
export interface Port { readonly value: number }
`)
// A body with no import or export: a script by syntax, but still a module, so
// its hidden binding never clashes with the script global in globals.ts.
const unexported = rule(`
const hidden = 1
;(globalThis as { ran?: number }).ran = hidden
`)

const projects = [
  { name: "exported", source: "main.vibe", body: exported, use: (from) => `export { port, wrong } from ${from}\nexport type { Port } from ${from}\n` },
  { name: "exported-vibex", source: "main.vibex", body: exported, use: (from) => `export { port, wrong } from ${from}\n` },
  ...["legacy", "auto", "force"].map(detection => ({
    name: "unexported-" + detection, source: "main.vibe", body: unexported, detection,
    use: (from) => `import ${from}\nexport const ran = (globalThis as { ran?: number }).ran\n`,
  })),
]

function compile(project, files, detection) {
  rmSync(project, { recursive: true, force: true })
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(project, "globals.ts"), "const hidden = 2\n")
  for (const [name, text] of Object.entries(files)) writeFileSync(join(project, name), text)
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", jsx: "react-jsx", strict: true,
      skipLibCheck: true, types: [], declaration: true, outDir: "out",
      ...(detection ? { moduleDetection: detection } : {}),
    },
    vibe: { effectGlobals: false, effectModules: false },
  }))
  const result = spawnSync(compiler, ["-p", project, "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
  assert.ifError(result.error)
  // A diagnostic's file and position move with the body; its code and text must not.
  const diagnostics = (result.stdout + result.stderr).split("\n").filter(line => /: error /.test(line))
    .map(line => line.replace(/^[^(]*\(\d+,\d+\): /, "")).sort()
  return { diagnostics, read: (name) => readFileSync(join(project, "out", name), "utf8").replace(/\n\/\/# sourceMappingURL=.*$/, "\n") }
}

const summary = []
for (const p of projects) {
  const root = join(dir, "out", "fixtures", p.name)
  const extension = p.source.endsWith(".vibex") ? ".tsx" : ".ts"
  const inlineSource = "module parse {\n" + p.body.replace(/^(?=.)/gm, "  ") + "}\n" + p.use("parse")
  const moved = p.body + (p.body.includes("export ") ? "" : "export {}\n")
  const inline = compile(join(root, "inline"), { [p.source]: inlineSource }, p.detection)
  const twin = compile(join(root, "moved"), { [p.source]: p.use('"./parse.js"'), ["parse" + extension]: moved }, p.detection)
  assert.deepEqual(inline.diagnostics, twin.diagnostics, p.name + ": diagnostics")
  assert.ok(!inline.diagnostics.some(d => d.startsWith("error TS2451")), p.name + ": the body shares the script scope\n" + inline.diagnostics.join("\n"))
  const stem = p.source + ".parse"
  assert.equal(inline.read(stem + ".js"), twin.read("parse.js"), p.name + ": body JavaScript")
  assert.equal(inline.read(stem + ".d.ts"), twin.read("parse.d.ts"), p.name + ": body declarations")
  const main = p.source.replace(/\.vibex?$/, "")
  assert.equal(inline.read(main + ".js").replaceAll("./" + stem + ".js", "./parse.js"), twin.read(main + ".js"), p.name + ": importer JavaScript")
  assert.equal(inline.read(main + ".d.ts").replaceAll("./" + stem + ".js", "./parse.js"), twin.read(main + ".d.ts"), p.name + ": importer declarations")
  const before = await import(pathToFileURL(join(root, "inline", "out", main + ".js")).href)
  const after = await import(pathToFileURL(join(root, "moved", "out", main + ".js")).href)
  if (p.body === exported) {
    for (const m of [before, after]) {
      assert.equal(m.port("8080"), 8080)
      assert.throws(() => m.port("x"), (e) => e instanceof RangeError && e.message === "bad port: x")
    }
    assert.equal(before.wrong, after.wrong)
    assert.deepEqual(inline.diagnostics, ["error TS2322: Type 'string' is not assignable to type 'number'."], p.name)
  } else {
    assert.equal(before.ran, 1)
    assert.equal(after.ran, 1)
    assert.equal(inline.read(stem + ".d.ts"), "export {};\n", p.name + ": a body declares a module")
    assert.match(inline.read(stem + ".js"), /^export \{\};$/m, p.name + ": a body emits a module")
    assert.deepEqual(inline.diagnostics, [], p.name)
  }
  summary.push(p.name)
}
console.log(JSON.stringify(summary))

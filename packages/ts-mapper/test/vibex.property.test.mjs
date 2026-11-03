import assert from "node:assert/strict"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import fc from "fast-check"
import { client } from "./protocol-client.mjs"

const { VIBEX_MAPPER: mapper, VIBEX_STOCK: stock, VIBEX_RUNTIME: runtime, VIBEX_EFFECT: effect } = process.env

function fixture() {
  for (const [name, value] of Object.entries({ mapper, stock, runtime, effect })) assert.ok(value, `missing ${name}; run bash test/e2e.sh`)
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "vibex-property-"))
  const pkg = join(root, "node_modules/vibelang-ts-mapper")
  mkdirSync(join(pkg, "bin"), { recursive: true })
  copyFileSync(new URL("../package.json", import.meta.url), join(pkg, "package.json"))
  copyFileSync(new URL("../prelude.d.ts", import.meta.url), join(pkg, "prelude.d.ts"))
  symlinkSync(mapper, join(pkg, "bin/vibelang-mapper"))
  symlinkSync(effect, join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
  return root
}

// VIP-39 (docs/design/vips/0039-vibex.md):
// "`.vibex` = `ScriptKindTSX` plus VibeLang." Stock TSX is the oracle.
test("vibex JSX survives projection and stock TSX checking", async () => {
  const root = fixture()
  const rpc = client(mapper, [], root)
  try {
    await rpc.request("initialize", { positionEncodings: ["utf-8"] })
    await rpc.request("openProject", { projectHandle: "vibex", compilerOptions: { jsx: "preserve" } })
    await fc.assert(fc.asyncProperty(fc.record({
      tag: fc.constantFrom("p", "section", "custom-element"),
      text: fc.constantFrom("hé😀", "% |&gt; !", "&amp;", "// not a comment"),
      eol: fc.constantFrom("\n", "\r\n"),
      depth: fc.integer({ min: 0, max: 4 }),
      form: fc.constantFrom("raw", "pipe", "do", "try"),
      value: fc.integer({ min: -100, max: 100 }),
      fragment: fc.boolean()
    }), async ({ tag, text, eol, depth, form, value, fragment }) => {
      const hole = { raw: String(value), pipe: `(${value} |> % + 1)`, do: `do { ${value}; }`, try: `try Effect.succeed(${value})` }[form]
      let jsx = `<${tag} title="% |> !" {...{id: "雪"}}>{/* c */}${text}{${hole}}</${tag}>`
      for (let i = 0; i < depth; i++) jsx = `<div>${eol}${jsx}${eol}</div>`
      if (fragment) jsx = `<>${jsx}</>`
      const source = form === "try" ? `export effect function view() { return ${jsx} }${eol}` : `export const view = ${jsx}${eol}`
      const output = await rpc.request("transform", { projectHandle: "vibex", fileName: join(root, "view.vibex"), content: source })
      assert.equal(output.extension, ".tsx")
      assert.deepEqual(output.diagnostics || [], [])
      if (form === "raw") assert.ok(output.text.endsWith(source), "JSX-only source must remain byte-for-byte unchanged after the synthesized prelude")
      const original = Buffer.from(source), virtual = Buffer.from(output.text)
      for (const [v, length, o, size, kind] of output.mappings) {
        if (kind === 0) assert.deepEqual(virtual.subarray(v, v + length), original.subarray(o, o + size))
      }
      writeFileSync(join(root, "view.tsx"), output.text)
      writeFileSync(join(root, "jsx.d.ts"), "declare namespace JSX { interface IntrinsicElements { [tag: string]: any } }")
      const result = spawnSync(stock, ["--ignoreConfig", "--target", "es2022", "--module", "nodenext", "--skipLibCheck", "--noEmit", "--jsx", "preserve", "--strict", "view.tsx", "jsx.d.ts"], { cwd: root, encoding: "utf8", timeout: 60000 })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }), { numRuns: Number(process.env.FC_NUM_RUNS || 100), seed: 39 })
  } finally { await rpc.close(); rmSync(root, { recursive: true, force: true }) }
})

test("stock host checks .vibex and maps JSX prop diagnostics to the source", () => {
  const root = fixture()
  try {
    const source = readFileSync(new URL("./fixture/src/view.vibex", import.meta.url), "utf8")
    writeFileSync(join(root, "view.vibex"), source)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { noEmit: true, jsx: "preserve", strict: true, skipLibCheck: true, target: "es2022", module: "nodenext" },
      contentMappers: [{ package: "vibelang-ts-mapper", extensions: [".vibe", ".vibex"] }], files: ["view.vibex"]
    }))
    const run = () => spawnSync(stock, ["-p", ".", "--runExternalCode", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 60000 })
    let result = run()
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const bad = source.replace('title="% |> !"', 'title={123}')
    writeFileSync(join(root, "view.vibex"), bad)
    result = run()
    assert.ifError(result.error)
    assert.equal(result.status, 2, result.stdout + result.stderr)
    const line = bad.slice(0, bad.indexOf("title={123}")).split("\n").length
    const column = bad.split("\n")[line - 1].indexOf("title={123}") + 1
    assert.match(result.stdout, new RegExp(`view\\.vibex\\(${line},${column}\\): error TS2322`))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

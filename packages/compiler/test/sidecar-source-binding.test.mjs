// Coverage census: same-basename native sibling and explicit Vibe import keep distinct payload types.
// VIP-27 same-basename native sibling and explicit Vibe import keep distinct payload types: docs/design/vips/0027-declaration-output.md#08030251660580c7
// VIP-27 same-basename native sibling and explicit Vibe import keep distinct payload types: docs/design/vips/0027-declaration-output.md#4a2acb45845ab421
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const stock = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "typescript/bin/tsc")
const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], noEmit: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true }

function check({ directory = ".vibe/declarations", style = ".js", name = "tag", form = "annotation", publicOutput = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sidecar-source-binding-"))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    put("package.json", '{"type":"module"}')
    for (const [extension, kind] of [[".vibe", "vibe"], [".ts", "native"]]) {
      put("src/" + name + extension, `export interface Tag { readonly kind: "${kind}" }\nexport function createTag(): Tag { return {kind:"${kind}"} }\n`)
    }
    const source = "./" + name + ".vibe", other = "./" + name + ".ts"
    const forms = {
      annotation: `import type { Tag } from "${source}"; export function make(): Tag { return {kind:"vibe"} }`,
      namespace: `import * as V from "${source}"; export function make(): V.Tag { return V.createTag() }`,
      inferred: `import { createTag } from "${source}"; export const value = createTag()`,
      star: `export * from "${source}"`,
      both: `import type { Tag as VibeTag } from "${source}"; import type { Tag as NativeTag } from "${other}"; export function make(): VibeTag { return {kind:"vibe"} }; export function native(x: NativeTag): NativeTag { return x }`,
      reexport: `export { Tag as VibeTag } from "${source}"; export type { Tag as NativeTag } from "${other}"`
    }
    put("src/index.vibe", forms[form] + "\n")
    put("tsconfig.json", JSON.stringify({
      compilerOptions: { ...options, ...(publicOutput ? { noEmit: false, declaration: true, emitDeclarationOnly: true, declarationDir: "public", rootDir: "." } : {}), ...(style === null ? {} : { vibelang: { declarationImportStyle: style } }) },
      files: ["src/index.vibe"], ...(directory === null ? {} : { vibe: { sidecarDir: directory } })
    }))
    const emit = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(emit.status, 0, emit.stdout + emit.stderr)
    if (publicOutput) {
      const publicText = readFileSync(join(root, "public/src/index.d.ts"), "utf8")
      const extension = style === "extensionless" ? "" : style
      assert.ok(publicText.includes('from "' + "./" + name + extension + '"'), publicText)
    }
    const consumers = {
      annotation: 'import { make } from "./src/index.vibe"; const kind: "vibe" = make().kind;',
      namespace: 'import { make } from "./src/index.vibe"; const kind: "vibe" = make().kind;',
      inferred: 'import { value } from "./src/index.vibe"; const kind: "vibe" = value.kind;',
      star: 'import { Tag } from "./src/index.vibe"; declare const tag: Tag; const kind: "vibe" = tag.kind;',
      both: 'import { make, native } from "./src/index.vibe"; const kind: "vibe" = make().kind; declare const tag: Parameters<typeof native>[0]; const other: "native" = tag.kind;',
      reexport: 'import type { VibeTag, NativeTag } from "./src/index.vibe"; declare const tag: VibeTag; declare const other: NativeTag; const kind: "vibe" = tag.kind; const name: "native" = other.kind;'
    }
    put("consumer.ts", consumers[form] + "\n")
    put("consumer.config.json", JSON.stringify({
      compilerOptions: { ...options, ...(directory === null ? {} : { rootDirs: [".", directory] }) },
      files: ["consumer.ts"]
    }))
    const checked = spawnSync(process.execPath, [stock, "-p", "consumer.config.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(checked.status, 0, JSON.stringify({ directory, style, name, form }) + "\n" + checked.stdout + checked.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("adjacent default sidecars preserve explicit Vibe source bindings", () => check({ directory: null, style: null }))

test("an explicit Vibe import keeps its source when a native sibling has the same basename", () => check())

// Chapter 007 / explicit Vibe module identity survives sibling files and declarations: docs/design/src/007-tooling.md#81db21426646122b
test("property: sidecars preserve written and inferred source bindings across styles and layouts", { timeout: 600000 }, () => {
  // VIP-27: declarations preserve source types. A written .vibe import selects that source (chapter007).
  const corpus = JSON.parse(readFileSync(new URL("./corpus/sidecar-shadowed-vibe-source.json", import.meta.url), "utf8"))
  fc.assert(fc.property(fc.record({
    directory: fc.constantFrom(null, ".vibe/declarations", "types"),
    style: fc.constantFrom(".js", ".ts", "extensionless"),
    name: fc.constantFrom("tag", "deep/tag", "Ω", ".hidden"),
    form: fc.constantFrom("annotation", "namespace", "inferred", "star", "both", "reexport")
  }), input => { check(input) }), {
    examples: [[corpus.input], [{ directory: null, style: ".ts", name: "tag", form: "both" }], [{ directory: "types", style: "extensionless", name: "deep/tag", form: "inferred" }]],
    seed: 2683127, numRuns: Number(process.env.FC_RUNS || 6)
  })
})

test("ordinary public declarations retain each configured spelling beside compatibility output", () => {
  for (const style of [".js", ".ts", "extensionless"]) check({ style, publicOutput: true })
})

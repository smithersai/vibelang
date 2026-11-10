import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { recordDeclarationSurface } from "../lib/declarations.mjs"
import { apiProjection } from "../lib/api-projection.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-native-declaration-alias.json", import.meta.url)))

test("native declaration aliases quote the API identity contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(corpus.quote))
})

function witness({ extension = ".vibe", depth = 0, shape = "star", relocated = false, name = "Cli", mutation = "same" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "native-declaration-alias-"))
  const pkg = join(root, "pkg"), snapshot = join(root, "snapshot")
  const sub = "nested/".repeat(depth), source = "src/" + sub + name + extension
  const sidecar = (relocated ? "types/" : "src/") + sub + name + ".d" + extension + ".ts"
  const native = sidecar.replace(/\.d\.vibex?\.ts$/, ".d.ts")
  const output = sub + name + ".d.ts", reference = "./" + name + extension
  const put = (directory, file, text) => { mkdirSync(dirname(join(directory, file)), { recursive: true }); writeFileSync(join(directory, file), text) }
  const declaration = shape === "equals" ? "declare const value: unique symbol;\nexport = value;\n"
    : "export declare const value: number;\n" + (shape === "default" ? "export default value;\n" : "")
  let forwarding = shape === "equals" ? "import original = require(" + JSON.stringify(reference) + ");\nexport = original;\n"
    : "export * from " + JSON.stringify(reference) + ";\n" + (shape === "default" ? "export { default } from " + JSON.stringify(reference) + ";\n" : "")
  if (mutation === "foreign") forwarding = forwarding.replaceAll(reference, "./other" + extension)
  if (mutation === "extra") forwarding += "export declare const extra: string;\n"
  if (mutation === "type-only") forwarding = "export type * from " + JSON.stringify(reference) + ";\n"
  try {
    put(pkg, "package.json", JSON.stringify({ name: "declaration-alias-fixture", type: "module", exports: { "./entry": "./" + source.replace(/\.vibex?$/, ".ts") } }))
    put(pkg, "tsconfig.json", JSON.stringify({ compilerOptions: {
      rootDir: "src", outDir: "dist", declaration: true, module: "nodenext", moduleResolution: "nodenext", jsx: "preserve", types: []
    }, include: ["src"], ...(relocated ? { vibe: { sidecarDir: "types" } } : {}) }))
    put(pkg, source, "export const value = 42;\n")
    put(pkg, sidecar, declaration)
    put(pkg, native, forwarding)
    put(snapshot, output, declaration)
    const surface = recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }])
    const target = surface.apiMetadata.aliases[source]
    assert.equal(target, output)
    if (mutation !== "same") {
      assert.notEqual(surface.apiMetadata.aliases[native], target, "an authored declaration must retain its own identity")
      assert.ok(surface.apiMetadata.aliases[native].startsWith(".migrate-shipped/"))
      return
    }
    assert.equal(surface.apiMetadata.aliases[native], target, "the native forwarder must share its source's emitted owner")
    assert.ok(!Object.values(surface.apiMetadata.aliases).some(file => file === ".migrate-shipped/" + native))
    const projection = apiProjection(ts, snapshot, surface, [...new Set(Object.values(surface.apiMetadata.aliases))])
    try { assert.ok(projection.directory) } finally { projection.cleanup() }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const extension of [".vibe", ".vibex"])
  for (const shape of ["star", "default", "equals"])
    for (const relocated of [false, true])
      test("native forwarding owner " + [extension, shape, relocated ? "relocated" : "beside"].join(" "), () =>
        witness({ extension, shape, relocated }))
for (const mutation of ["foreign", "extra", "type-only"])
  test("native aliases preserve an authored " + mutation + " declaration", () => witness({ mutation }))
test("property: native forwarding declarations retain one emitted owner", async () => {
  await checkProperty(fc, { name: corpus.key, rule: corpus.quote,
    command: "node --test .smithers/flows/migrate/test/native-declaration-alias.property.test.mjs",
    numRuns: 40, arbitrary: fc.record({
      extension: fc.constantFrom(".vibe", ".vibex"), depth: fc.integer({ min: 0, max: 3 }),
      shape: fc.constantFrom("star", "default", "equals"), relocated: fc.boolean(),
      name: fc.constantFrom("Cli", "With space", "Ålias"), mutation: fc.constantFrom("same", "foreign", "extra", "type-only")
    }), check: witness })
})

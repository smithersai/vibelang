import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { recordDeclarationSurface, compareDeclarations } from "../lib/declarations.mjs"
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-sidecar-export-alias.json", import.meta.url)))
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url)),
  ts = require("typescript"),
  fc = require("fast-check")
// Specification: each export's type is identical to tsc's in both directions.
function fixture({
  extension = "vibe",
  mirror = corpus.sidecarDir,
  changed = false,
  duplicate = false,
  value = "a"
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "sidecar-api-")),
    dirs = []
  try {
    for (const side of ["before", "after"]) {
      const pkg = join(root, side),
        out = join(pkg, "snapshot")
      mkdirSync(join(pkg, "src"), { recursive: true })
      mkdirSync(out)
      dirs.push(out)
      const native = side === "before",
        file = "src/main." + (native ? extension : "ts"),
        physical = mirror + "/src/main.d." + extension + ".ts"
      const text = `export declare class Value { private brand; readonly kind: ${JSON.stringify(value)}; }\nexport declare function make(): Value;\n`
      writeFileSync(
        join(pkg, file),
        `export class Value { private brand = undefined; readonly kind = ${JSON.stringify(value)} as const; }\nexport function make(): Value { return new Value(); }\n`
      )
      writeFileSync(join(pkg, "src/index.ts"), 'export * from "./main.js";\n')
      writeFileSync(join(out, "main.d.ts"), text)
      writeFileSync(join(out, "index.d.ts"), 'export * from "./main.js";\n')
      writeFileSync(
        join(pkg, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            rootDir: "src",
            outDir: "dist",
            declaration: true,
            rootDirs: [".", mirror],
            module: "ESNext",
            moduleResolution: "Bundler"
          },
          include: ["src/**/*"]
        })
      )
      if (native) {
        mkdirSync(join(pkg, mirror, "src"), { recursive: true })
        writeFileSync(join(pkg, physical), changed ? text.replace(JSON.stringify(value), '"other"') : text)
        if (duplicate) writeFileSync(join(pkg, "src/main.d." + extension + ".ts"), text)
      }
      const target = native ? "./" + physical : "./" + file
      const exp = native
        ? {
            types: target,
            import: { types: target, "vibelang-source": "./" + file, default: "./.vibelang/js/src/main.js" },
            default: { types: target, "vibelang-source": "./" + file, default: "./.vibelang/js/src/main.js" }
          }
        : { types: target, import: target, default: target }
      const manifest = { name: "fixture", type: "module", exports: { ".": { types: "./src/index.ts" }, "./main": exp } }
      writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest))
      recordDeclarationSurface(ts, out, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }], manifest)
    }
    const before = JSON.parse(readFileSync(join(dirs[0], "public-surface.json"))).apiMetadata
    if (!changed && !duplicate)
      assert.equal(
        before.aliases[mirror + "/src/main.d." + extension + ".ts"],
        "main.d.ts",
        "physical sidecar has no owner alias"
      )
    else
      assert.equal(
        before.aliases[mirror + "/src/main.d." + extension + ".ts"],
        undefined,
        "conflicting sidecar must not be aliased"
      )
    const result = compareDeclarations(ts, ...dirs, { canonical: true })
    if (!changed && !duplicate) {
      assert.equal(result.identical, true, JSON.stringify(result))
      assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    } else assert.equal(result.identical, false, "changed or ambiguous sidecars must not compare identical")
    return result
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
test("sidecar mirror keeps root and subpath nominal identities", () => fixture())
test("a changed physical sidecar cannot borrow the emitted declaration", () => fixture({ changed: true }))
test("two present mirrors cannot collapse distinct declaration identities", () => fixture({ duplicate: true }))
test("property: source suffix, mirrored path and private brand preserve identity", () =>
  fc.assert(
    fc.property(
      fc.constantFrom("vibe", "vibex"),
      fc.constantFrom(".vibe/declarations", ".generated/types", "types output"),
      fc.stringMatching(/^[a-z]{1,6}$/),
      (extension, mirror, value) => {
        fixture({ extension, mirror, value })
      }
    ),
    { numRuns: 12 }
  ))

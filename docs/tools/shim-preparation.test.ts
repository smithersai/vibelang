import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkShimAvailability } from "./shim-availability.mjs"

function fixture({ compiler = "0.0.12", published = "0.0.11", shim = "7.1.12", versions = [], alias = shim, privatePackage = false, dependency = compiler, previous = published, name = "vibelang-typescript" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "shim-preparation-"))
  const write = (file, value) => {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n")
  }
  write("packages/compiler/package.json", { version: compiler })
  write("packages/typescript-shim/package.json", { name, version: shim, private: privatePackage, dependencies: { vibelang: dependency } })
  write("docs/tools/release-publication-snapshot.json", { package: "vibelang", version: published })
  write("docs/tools/shim-publication.json", { registry: "https://registry.npmjs.org", package: "vibelang-typescript", versions })
  write("docs/design/vips/0042-vibelang-in-ts-files-open.md", "**Status:** open.\n")
  const baseline = compiler === published ? compiler.split(".").slice(0, 2).join(".") + "." + (Number(compiler.split(".")[2]) - 1) : previous
  write("docs/user/src/setup/release-notes.md", "## " + compiler + "\n### Bugs fixed since " + baseline + "\n### Upgrade from " + baseline + "\n## " + baseline + "\n")
  const text = "Experimental preview.\nnpm install typescript@npm:vibelang-typescript" + (alias ? "@" + alias : "") + "\n"
  write("docs/user/src/setup/typescript-shim.md", text)
  write("packages/typescript-shim/README.md", text)
  return { root, write, text, close: () => rmSync(root, { recursive: true, force: true }) }
}

test("a coherent prepared release admits its exact source alias without recording publication", () => {
  const f = fixture()
  try {
    const before = readFileSync(join(f.root, "docs/tools/shim-publication.json"), "utf8")
    assert.deepEqual(checkShimAvailability(f.root), [])
    assert.equal(readFileSync(join(f.root, "docs/tools/shim-publication.json"), "utf8"), before)
    for (const alias of ["", "7.1.13"]) {
      f.write("docs/user/src/setup/typescript-shim.md", f.text.replace("@7.1.12", alias ? "@" + alias : ""))
      assert.ok(checkShimAvailability(f.root).some(problem => /unavailable replacement package/.test(problem)))
    }
  } finally { f.close() }
})

test("a stable source release still rejects an unpublished npm replacement", () => {
  const f = fixture({ compiler: "0.0.11", published: "0.0.11", shim: "7.1.11" })
  try {
    assert.ok(checkShimAvailability(f.root).some(problem => /not available from npm/.test(problem)))
    assert.ok(checkShimAvailability(f.root).some(problem => /unavailable replacement package/.test(problem)))
  } finally { f.close() }
})

test("prepared aliases require the actual public source package and matching compiler dependency", () => {
  for (const options of [{ privatePackage: true }, { dependency: "0.0.11" }, { name: "another-package" }, { shim: ["7.1.12"] }, { shim: "next" }]) {
    const f = fixture(options)
    try { assert.throws(() => checkShimAvailability(f.root), /prepared shim/) }
    finally { f.close() }
  }
})

test("prepared aliases cannot bypass an incoherent release history", () => {
  const f = fixture({ previous: "0.0.10" })
  try { assert.throws(() => checkShimAvailability(f.root), /actually published/) }
  finally { f.close() }
})

test("once compiler publication is recorded the shim requires its own registry receipt", () => {
  const f = fixture({ compiler: "0.0.12", published: "0.0.12" })
  try {
    assert.ok(checkShimAvailability(f.root).some(problem => /unavailable replacement package/.test(problem)))
    f.write("docs/tools/shim-publication.json", { registry: "https://registry.npmjs.org", package: "vibelang-typescript", versions: ["7.1.12"] })
    assert.deepEqual(checkShimAvailability(f.root), [])
  } finally { f.close() }
})

test("generated candidates distinguish source preparation from published, wrong and unversioned aliases", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 400 }), fc.boolean(), (patch, shimPatch, published) => {
    const compiler = "0.0." + (patch + 1), baseline = "0.0." + patch, shim = "7.1." + shimPatch
    const f = fixture({ compiler, published: baseline, shim, versions: published ? [shim] : [] })
    try {
      assert.deepEqual(checkShimAvailability(f.root), [])
      f.write("docs/user/src/setup/typescript-shim.md", f.text.replace("@" + shim, "@7.1." + (shimPatch + 1)))
      assert.ok(checkShimAvailability(f.root).some(problem => /unavailable replacement package/.test(problem)))
      if (!published) {
        f.write("docs/user/src/setup/typescript-shim.md", f.text.replace("@" + shim, ""))
        assert.ok(checkShimAvailability(f.root).some(problem => /unavailable replacement package/.test(problem)))
      }
    } finally { f.close() }
  }), { seed: 421112, numRuns: 200 })
})

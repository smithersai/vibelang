import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { prepareToolchainPublication } from "../lib/toolchain-publication.mjs"
import { toolchainSpecs } from "../lib/wire.mjs"
const require = createRequire(new URL("../../../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")

// Generated manifests in four indentations, with dependencies printed over
// lines or inline: publishing the staged toolchain changes each local
// VibeLang pin to its release and nothing else, so the upgraded manifest is
// the original text with only those string values replaced.
test("toolchain publication keeps a manifest's layout and changes only the pinned values", () => {
  fc.assert(fc.property(
    fc.constantFrom(0, 2, 4, "\t"), fc.boolean(), fc.constantFrom("pnpm", "bun", "yarn"),
    fc.subarray(["vibelang-runtime", "vibelang"], { minLength: 1 }), fc.constantFrom("1.0.0", "0.0.11", "2.3.4-rc.1"),
    (indent, inline, manager, names, version) => {
      const root = mkdtempSync(join(tmpdir(), "toolchain-publication-format-"))
      try {
        const staged = Object.fromEntries(names.map((name) => [name, name + "-staged"]))
        for (const name of names) {
          mkdirSync(join(root, ".vibelang-toolchain", staged[name]), { recursive: true })
          writeFileSync(join(root, ".vibelang-toolchain", staged[name], "package.json"), JSON.stringify({ name, version }))
        }
        const specsFor = (dir) => toolchainSpecs(dir, staged)
        writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }, null, indent) + "\n")
        const local = specsFor("packages/core")
        const dependencies = { effect: "4.0.6", ...Object.fromEntries(names.map((name) => [name, local[name]])) }
        const inlineDependencies = "{ " + Object.entries(dependencies).map(([k, v]) => JSON.stringify(k) + ": " + JSON.stringify(v)).join(", ") + " }"
        const manifest = { name: "core", version: "1.0.0", dependencies: "DEPENDENCIES", scripts: { build: "vibelang -b" } }
        let text = JSON.stringify(manifest, null, indent) + "\n"
        text = text.replace('"DEPENDENCIES"', inline ? inlineDependencies : JSON.stringify(dependencies, null, indent).replaceAll("\n", "\n" + (indent === "\t" ? "\t" : " ".repeat(indent))))
        mkdirSync(join(root, "packages/core"), { recursive: true })
        writeFileSync(join(root, "packages/core/package.json"), text)
        const result = prepareToolchainPublication({ target: root, manifests: ["package.json", "packages/core/package.json"], manager, specsFor })
        const expected = names.reduce((out, name) => out.replace(JSON.stringify(local[name]), JSON.stringify(version)), text)
        assert.notEqual(expected, text)
        assert.equal(readFileSync(join(root, "packages/core/package.json"), "utf8"), expected)
        assert.ok(result.changed.includes("packages/core/package.json"))
        assert.deepEqual(prepareToolchainPublication({ target: root, manifests: ["package.json", "packages/core/package.json"], manager, specsFor }).changed, [], "a second run changes nothing")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  ), { seed: 64701, numRuns: 120 })
})

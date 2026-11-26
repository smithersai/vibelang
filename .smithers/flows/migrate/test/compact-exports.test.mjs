import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compactExportMap, routeEmittedExports } from "../lib/emitted-exports.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

test("#301: component mode routes a fully-covered wildcard directly instead of adding redundant exact exports", () => {
  const root = mkdtempSync(join(tmpdir(), "compact-wildcard-exports-"))
  try {
    const original = {
      name: "@fixture/aws",
      type: "module",
      exports: {
        ".": "./src/index.ts",
        "./*": "./src/*.ts",
        "./*.d.vibe.ts": null
      }
    }
    put(root, "package.json", JSON.stringify(original, null, 2) + "\n")
    const outputs = {}
    const count = 250
    const lines = ['export { seed } from "./seed.vibe"\n']
    put(root, "src/seed.vibe", "export const seed = 1\n")
    put(root, ".vibelang/js/src/seed.js", "export const seed = 1\n")
    outputs["./src/seed.vibe"] = "./.vibelang/js/src/seed.js"
    for (let i = 0; i < count; i++) {
      const name = `mod${i}`
      const code = `import { seed } from "./seed.js"; export const value${i} = seed + ${i};\n`
      put(root, `src/${name}.ts`, code)
      put(root, `.vibelang/js/src/${name}.js`, code)
      outputs[`./src/${name}.ts`] = `./.vibelang/js/src/${name}.js`
      lines.push(`export { value${i} } from "./${name}.js";\n`)
    }
    const indexSource = lines.join("")
    const indexEmitted = lines.join("").replace("./seed.vibe", "./seed.js")
    put(root, "src/index.ts", indexSource)
    put(root, ".vibelang/js/src/index.js", indexEmitted)
    outputs["./src/index.ts"] = "./.vibelang/js/src/index.js"

    let graph
    assert.equal(routeEmittedExports(root, outputs, { typescript: ts, onGraph: g => { graph = g } }), true)
    assert.equal(graph.mode, "component")
    const routed = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    // Zero redundant exact entries added for the 250 modules covered by "./*".
    assert.deepEqual(Object.keys(routed.exports).sort(), [".", "./*", "./*.d.vibe.ts"])
    assert.deepEqual(routed.exports["./*"], {
      types: "./src/*.ts",
      "vibelang-source": "./src/*.ts",
      default: "./.vibelang/js/src/*.js"
    })
    assert.equal(routed.exports["./*.d.vibe.ts"], null)

    // Real Node resolution and TypeScript type resolution both select the right targets.
    const probe = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      'import { value0, value249 } from "@fixture/aws"; import { value42 } from "@fixture/aws/mod42"; console.log(JSON.stringify([value0, value42, value249]))'
    ], { cwd: root, encoding: "utf8" })
    assert.equal(probe.status, 0, probe.stdout + probe.stderr)
    assert.deepEqual(JSON.parse(probe.stdout), [1, 43, 250])

    put(root, "consumer.ts", "export {}\n")
    const resolvedType = ts.resolveModuleName("@fixture/aws/mod42", join(root, "consumer.ts"), {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext
    }, ts.sys).resolvedModule?.resolvedFileName
    assert.equal(resolvedType, join(root, "src/mod42.ts"))

    // Idempotent second call and exact restore.
    assert.equal(routeEmittedExports(root, outputs, { typescript: ts }), false)
    routeEmittedExports(root, {}, { restore: true })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), original)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#301: component mode keeps wildcard unrouted when an unemitted on-disk native module exists under it", () => {
  const root = mkdtempSync(join(tmpdir(), "compact-wildcard-partial-"))
  try {
    const original = {
      name: "@fixture/partial",
      type: "module",
      exports: { "./*": "./src/*.ts" }
    }
    put(root, "package.json", JSON.stringify(original, null, 2) + "\n")
    put(root, "src/leaf.vibe", 'export { a } from "./a.ts"\n')
    put(root, ".vibelang/js/src/leaf.js", 'export { a } from "./a.js"\n')
    put(root, "src/a.ts", "export const a = 1\n")
    put(root, ".vibelang/js/src/a.js", "export const a = 1\n")
    // On-disk native file outside outputs (e.g. excluded from tsconfig) stays unrouted.
    put(root, "src/untouched.ts", "export const untouched = 2\n")
    const outputs = {
      "./src/leaf.vibe": "./.vibelang/js/src/leaf.js",
      "./src/a.ts": "./.vibelang/js/src/a.js"
    }
    assert.equal(routeEmittedExports(root, outputs, { typescript: ts }), true)
    const routed = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    assert.equal(routed.exports["./*"], "./src/*.ts")
    assert.equal(routed.exports["./a"].default, "./.vibelang/js/src/a.js")
    assert.equal("./untouched" in routed.exports, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#301: compactExportMap removes redundant conversion-added exact keys while keeping authored keys, condition differences, and sidecar exclusions", () => {
  const map = {
    ".": { types: "./src/index.ts", "vibelang-source": "./src/index.ts", default: "./.vibelang/js/src/index.js" },
    "./*": { types: "./src/*.ts", "vibelang-source": "./src/*.ts", default: "./.vibelang/js/src/*.js" },
    "./*.d.vibe.ts": null,
    // Authored redundant exact key: MUST stay because it is in authoredKeys.
    "./authored": { types: "./src/authored.ts", "vibelang-source": "./src/authored.ts", default: "./.vibelang/js/src/authored.js" },
    // Conversion-added redundant exact keys: MUST be compacted away.
    "./s3/bucket": { types: { default: "./src/s3/bucket.ts" }, "vibelang-source": "./src/s3/bucket.ts", default: "./.vibelang/js/src/s3/bucket.js" },
    "./ec2/instance": { types: "./src/ec2/instance.ts", "vibelang-source": "./src/ec2/instance.ts", default: "./.vibelang/js/src/ec2/instance.js" },
    // Conversion-added exact key with DIFFERENT target (migrated .vibe module): MUST stay.
    "./lambda/fn": { types: "./src/lambda/fn.d.vibe.ts", "vibelang-source": "./src/lambda/fn.vibe", default: "./.vibelang/js/src/lambda/fn.js" },
    // Conversion-added null exclusion (private companion): MUST stay.
    "./lambda/fn.vibe.platform": null
  }
  const authoredKeys = new Set([".", "./*", "./*.d.vibe.ts", "./authored"])
  const { map: compacted, removed } = compactExportMap(map, { authoredKeys })
  assert.deepEqual(removed.sort(), ["./ec2/instance", "./s3/bucket"])
  assert.deepEqual(Object.keys(compacted).sort(), [
    ".",
    "./*",
    "./*.d.vibe.ts",
    "./authored",
    "./lambda/fn",
    "./lambda/fn.vibe.platform"
  ])
})

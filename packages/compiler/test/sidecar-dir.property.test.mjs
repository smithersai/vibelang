import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// Decided detail 268 amends VIP-27. The oracle is the amendment's text,
// quoted verbatim and checked against the VIP below.
const vip = fileURLToPath(new URL("../../../docs/design/vips/0027-declaration-output.md", import.meta.url))
const quotes = [
  "The Location bullet stays the default: `x.d.vibe.ts` beside `x.vibe`, with no configuration.",
  "`vibe.sidecarDir` moves every sidecar of the project into one directory, conventionally `.vibe/declarations`, at the path the source has under the config's directory, so `src/x.vibe` gets `.vibe/declarations/src/x.d.vibe.ts`.",
  "Switching the setting on or off removes each module's sidecar from the other place."
]

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const stockTsc = join(modules, "typescript/bin/tsc")
const missing = [native, stockTsc].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

test("the sidecar-directory oracle quotes VIP-27's amendment", () => {
  const text = readFileSync(vip, "utf8").replace(/\s+/g, " ")
  for (const quote of quotes) assert.ok(text.includes(quote), quote)
})

const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, noEmit: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true }
// A mode is where the sidecars go: beside the sources, the conventional
// directory, or another directory the config names.
const besideMode = (mode) => mode === "beside" || mode === "root"
const configFor = (mode) => JSON.stringify({
  compilerOptions: { ...options, ...(besideMode(mode) ? {} : { rootDirs: [".", placeOf(mode)] }) },
  include: ["src"],
  ...(mode === "beside" ? {} : { vibe: { sidecarDir: mode === "root" ? "" : placeOf(mode) } })
})
const placeOf = (mode) => besideMode(mode) ? "" : mode === "conventional" ? ".vibe/declarations" : mode === "overlap" ? "src/generated" : "gen/types"
const sidecarOf = (mode, module) => posix.join(placeOf(mode), "src", module + ".d.vibe.ts")
const relativeSpecifier = (from, to) => {
  const path = posix.relative(posix.dirname(from), to)
  return path.startsWith(".") ? path : "./" + path
}
const sidecarsUnder = (root, directory) => {
  const found = []
  const walk = (relative) => {
    const absolute = join(root, relative)
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = posix.join(relative, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith(".d.vibe.ts")) found.push(path)
    }
  }
  walk(directory)
  return found.sort()
}

const segment = fc.constantFrom("a", "b", "deep", "src", "x.y", "Ω")
// The nested output directory is inside the scanned src tree. Its generated
// prefix is distinct from source modules, preserving native rootDirs paths;
// actual source/output collisions have a separate cleanup property below.
const tree = fc.uniqueArray(
  fc.tuple(fc.array(segment, { maxLength: 2 }), fc.constantFrom("mod", "name", "util-1", "Ω")).map(([dirs, base]) => [...dirs, base].join("/")),
  { minLength: 1, maxLength: 5 }
).chain((paths) => fc.record({
  paths: fc.constant(paths),
  // Module i may import any earlier module.
  imports: fc.tuple(...paths.map((_, index) => fc.subarray([...Array(index).keys()]))),
  modes: fc.array(fc.constantFrom("beside", "root", "conventional", "custom"), { minLength: 1, maxLength: 3 }).map((modes) => [...modes, "overlap"])
}))

test("sidecar-directory: one sidecar per .vibe module in the chosen place, and stock tsc resolves each there", { skip, timeout: 600000 }, async () => {
  await checkProperty(fc, {
    name: "sidecar-directory",
    rule: "docs/design/vips/0027-declaration-output.md: Amendment: an opt-in sidecar directory (decided detail 268)",
    command: "node --test test/sidecar-dir.property.test.mjs",
    numRuns: 6,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: tree,
    check: async ({ paths, imports, modes }) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-sidecar-dir-property-")))
      try {
        const files = { "package.json": "{\"type\":\"module\"}\n" }
        paths.forEach((module, index) => {
          const from = posix.join("src", module + ".vibe")
          const lines = imports[index].map((j) => `import type { T${j} } from ${JSON.stringify(relativeSpecifier(from, posix.join("src", paths[j] + ".vibe")))}`)
          lines.push(`export type T${index} = { readonly v${index}: ${imports[index].length ? imports[index].map((j) => `T${j}`).join(" & ") : "string"} }`)
          files[from] = lines.join("\n") + "\n"
        })
        // A TypeScript consumer of every module, which stock tsc checks.
        files["src/consumer.ts"] = paths.map((module, index) => `import type { T${index} } from ${JSON.stringify(relativeSpecifier("src/consumer.ts", posix.join("src", module + ".vibe")))}`).join("\n") +
          `\nexport type All = ${paths.map((_, index) => `T${index}`).join(" | ")}\n`
        for (const [name, text] of Object.entries(files)) {
          mkdirSync(dirname(join(root, name)), { recursive: true })
          writeFileSync(join(root, name), text)
        }
        let previous
        for (const mode of modes) {
          writeFileSync(join(root, "tsconfig.json"), configFor(mode))
          const built = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
          assert.equal(built.status, 0, built.stdout + built.stderr)
          const chosen = paths.map((module) => sidecarOf(mode, module)).sort()
          // Exactly one sidecar per module where the mode puts it, and no other there.
          assert.deepEqual(sidecarsUnder(root, posix.join(placeOf(mode), "src")), chosen, `mode ${mode} after ${previous}`)
          // None left in the other known place: beside the sources, or the conventional directory.
          if (!besideMode(mode)) assert.deepEqual(sidecarsUnder(root, "src"), mode === "overlap" ? chosen : [], `stale beside after ${previous} -> ${mode}`)
          if (besideMode(mode) && previous !== "custom") assert.deepEqual(sidecarsUnder(root, ".vibe"), [], `stale conventional after ${previous} -> ${mode}`)
          // Stock tsc resolves each ./x.vibe to the chosen sidecar, and to no other.
          const stock = spawnSync(process.execPath, [stockTsc, "-p", "tsconfig.json", "--pretty", "false", "--explainFiles"], { cwd: root, encoding: "utf8" })
          assert.equal(stock.status, 0, stock.stdout + stock.stderr)
          const read = [...new Set(stock.stdout.split("\n").filter((line) => /^\S.*\.d\.vibe\.ts$/.test(line)).map((line) => line.trim()).map((path) => posix.isAbsolute(path) ? posix.relative(root, path) : posix.normalize(path)))].sort()
          assert.deepEqual(read, chosen, `stock tsc in mode ${mode}:\n${stock.stdout}`)
          previous = mode
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})


test("sidecar-overlap-cleanup: one output never removes another module's selected output", { skip, timeout: 600000 }, async () => {
  await checkProperty(fc, {
    name: "sidecar-overlap-cleanup",
    rule: "docs/design/vips/0027-declaration-output.md: directory amendment, mirrored source paths and stale cleanup",
    command: "node --test test/sidecar-dir.property.test.mjs",
    numRuns: 12,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      directory: fc.constantFrom("src", "gen/types", "src/deep"),
      module: fc.constantFrom("a", "x.y", "Ω"),
      reverse: fc.boolean()
    }),
    check: async ({ directory, module, reverse }) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-sidecar-overlap-")))
      try {
        const sources = [module + ".vibe", posix.join(directory, module + ".vibe")]
        const outputs = sources.map((source) => posix.join(directory, source.replace(/\.vibe$/, ".d.vibe.ts")))
        const files = {
          "package.json": '{"type":"module"}\n',
          "tsconfig.json": JSON.stringify({ compilerOptions: options, files: reverse ? [...sources].reverse() : sources, include: [], vibe: { sidecarDir: directory } }),
          [sources[0]]: "export type T0 = string\n",
          [sources[1]]: "export type T1 = number\n"
        }
        for (const source of sources) files[source.replace(/\.vibe$/, ".d.vibe.ts")] = "export type Stale = never\n"
        for (const [name, text] of Object.entries(files)) {
          mkdirSync(dirname(join(root, name)), { recursive: true })
          writeFileSync(join(root, name), text)
        }
        for (let run = 0; run < 2; run++) {
          const built = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
          assert.equal(built.status, 0, built.stdout + built.stderr)
          assert.deepEqual(sidecarsUnder(root, "."), [...outputs].sort())
          assert.match(readFileSync(join(root, outputs[0]), "utf8"), /export type T0 = string/)
          assert.match(readFileSync(join(root, outputs[1]), "utf8"), /export type T1 = number/)
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})

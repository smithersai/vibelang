import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { build } from "tsdown"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import vibelang from "../src/rolldown.js"

// A tsdown build with `dts` turns a .vibe module into the JavaScript and
// declaration files its .ts twin gives, and a .ts module's declarations keep
// the types it infers from a .vibe import. Each shape builds the same
// two-module package twice, once with internal/system.ts and once with
// internal/system.vibe, and compares the output names and what a consumer
// sees through the declarations.

const here = fileURLToPath(new URL(".", import.meta.url))
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url))
const regressions = new URL("./property-regressions/", import.meta.url)
const quotes = [
  ["../vips/0034-compiler-and-tooling.md", "**Existing tools work.** Type checkers work through `.d.vibe.ts` (VIP-27), and linters, Knip, bundlers and test runners each read `.vibe`."],
  ["007-tooling.md", "Output names follow the native twin: `x.vibe` emits `x.js` and `x.d.ts` in `outDir`"],
  ["007-tooling.md", "Bundler plugins use the same names"],
  ["007-tooling.md", "A published package carries JavaScript and ordinary `.d.ts` files."]
]
const rule = quotes[0][1]

test("tsdown declaration coverage quotes the tooling contract", () => {
  for (const [chapter, quote] of quotes) assert.ok(readFileSync(SpecPath(chapter), "utf8").includes(quote), chapter + ": " + quote)
})

// The exported type, how the module makes a value of it, and how a consumer
// tells the real type from any or unknown.
const typeForms = {
  interface: {
    declare: 'export interface System { readonly name: "system"; readonly port: number }',
    make: 'export const make = (port: number): System => ({ name: "system", port })',
    type: "System", read: ".port", good: "number", bad: "string"
  },
  alias: {
    declare: 'export type System = { readonly name: "system"; readonly port: number }',
    make: 'export const make = (port: number): System => ({ name: "system", port })',
    type: "System", read: ".port", good: "number", bad: "string"
  },
  class: {
    declare: "export class System { readonly name = \"system\" as const; constructor(readonly port: number) {} }",
    make: "export const make = (port: number): System => new System(port)",
    type: "System", read: ".port", good: "number", bad: "string"
  },
  effect: {
    declare: 'import * as Effect from "effect/Effect"\nexport class SystemError { readonly _tag = "SystemError" }\nexport type System = Effect.Effect<number, SystemError>',
    make: "export const make = (port: number): System => port < 0 ? Effect.fail(new SystemError()) : Effect.succeed(port)",
    // unknown in the error channel still rejects never, so the good line
    // names the error's shape.
    type: "System", read: "", good: 'import("effect/Effect").Effect<number, { readonly _tag: "SystemError" }>', bad: 'import("effect/Effect").Effect<number, never>'
  }
}

const dirs = { internal: "internal/", sibling: "", deep: "core/internal/" }

function sources(shape, ext) {
  const form = typeForms[shape.typeForm]
  const spec = "./" + dirs[shape.dir] + "system." + ext
  const annotation = shape.annotation === "explicit" ? ": " + (shape.form === "namespace" ? "Sys." : "") + form.type : ""
  const imports = {
    named: "import { make, type " + form.type + ' } from "' + spec + '"',
    namespace: 'import * as Sys from "' + spec + '"',
    type: "import type { " + form.type + ' } from "' + spec + '"'
  }[shape.form]
  const call = shape.form === "namespace" ? "Sys.make" : "make"
  const body = shape.form === "type"
    ? "export const layer = (port: number)" + annotation + " => ({ port }) as unknown as " + form.type
    : "export const layer = (port: number)" + annotation + " => " + call + "(port)"
  return {
    ["src/" + dirs[shape.dir] + "system." + ext]: form.declare + "\n" + form.make + "\n",
    "src/services.ts": imports + "\n" + body + "\n"
  }
}

async function list(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])) {
    if (e.isFile() && !e.name.endsWith(".map")) out.push(relative(dir, join(e.parentPath, e.name)))
  }
  return out.sort()
}

async function emit(shape, ext) {
  await mkdir(join(here, ".fixtures"), { recursive: true })
  const root = await mkdtemp(join(here, ".fixtures", "tsdown-declarations-"))
  const previous = process.cwd()
  try {
    // effect is the package's peer, so both builds leave its types external.
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module","peerDependencies":{"effect":"*"}}')
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: "ESNext", module: "Preserve",
        moduleResolution: "Bundler", allowImportingTsExtensions: true, types: [] },
      include: ["src/**/*"]
    }))
    for (const [name, text] of Object.entries(sources(shape, ext))) {
      await mkdir(join(root, name, ".."), { recursive: true })
      await writeFile(join(root, name), text)
    }
    const system = "src/" + dirs[shape.dir] + "system." + ext
    const entry = shape.layout === "entries" ? ["src/services.ts", system] : ["src/services.ts"]
    process.chdir(root)
    await build({ entry, format: "esm", dts: true, unbundle: shape.unbundle, plugins: [vibelang()], outDir: "dist", exports: false, logLevel: "silent" })
    process.chdir(previous)
    const files = await list(join(root, "dist"))
    const form = typeForms[shape.typeForm]
    const { good, bad } = form
    await writeFile(join(root, "consumer.mts"), [
      'import { layer } from "./dist/services.mjs"',
      "const good: " + good + " = layer(1)" + form.read,
      "// @ts-expect-error the declared type is not any or unknown",
      "const bad: " + bad + " = layer(1)" + form.read,
      "void good; void bad", ""
    ].join("\n"))
    const checked = spawnSync(process.execPath, [tsc, "--strict", "--noEmit", "--skipLibCheck", "--target", "ESNext",
      "--module", "NodeNext", "--moduleResolution", "NodeNext", "consumer.mts"], { cwd: root, encoding: "utf8" })
    const declaration = await readFile(join(root, "dist/services.d.mts"), "utf8").catch(() => "")
    return {
      js: files.filter((f) => !/\.d\.[cm]?ts$/.test(f)),
      dts: files.filter((f) => /\.d\.[cm]?ts$/.test(f)),
      consumer: { status: checked.status, output: (checked.stdout + checked.stderr).trim() },
      declaration
    }
  } finally {
    process.chdir(previous)
    await rm(root, { recursive: true, force: true })
  }
}

async function check(shape) {
  const twin = await emit(shape, "ts")
  const vibe = await emit(shape, "vibe")
  assert.equal(twin.consumer.status, 0, "the .ts twin's consumer fails: " + twin.consumer.output)
  assert.deepEqual(vibe.js, twin.js, "JavaScript outputs differ from the .ts twin")
  assert.deepEqual(vibe.dts, twin.dts, "declaration outputs differ from the .ts twin: " + vibe.dts.join(", ") + " against " + twin.dts.join(", "))
  assert.equal(vibe.consumer.status, 0, "consumer types differ from the .ts twin: " + vibe.consumer.output + "\nservices.d.mts:\n" + vibe.declaration)
}

const shapes = fc.record({
  layout: fc.constantFrom("importer", "entries"),
  unbundle: fc.boolean(),
  annotation: fc.constantFrom("explicit", "inferred"),
  form: fc.constantFrom("named", "namespace", "type"),
  typeForm: fc.constantFrom(...Object.keys(typeForms)),
  dir: fc.constantFrom(...Object.keys(dirs))
}).filter((shape) => shape.form !== "type" || shape.annotation === "explicit")

// Today three gaps hold, each replayed from property-regressions/ and failing
// as XPASS once it closes: an inferred type from a .vibe import is any
// (alchemy-tsdown-inferred-vibe-error-channel, tsdown-inferred-vibe-type-any),
// an unbundled .vibe module's declaration is named x.vibe.d.mts
// (tsdown-unbundled-vibe-declaration-name), and a .vibe entry of a bundled
// build has none (tsdown-vibe-entry-missing-declaration). The property
// explores the shapes outside them; widen it as each gap closes.
const outsideKnownGaps = (shape) => shape.annotation === "explicit" && !shape.unbundle && shape.layout === "importer"

test("property: tsdown declarations of a .vibe module and its importers match the .ts twin's", { timeout: 600000 }, async () => {
  await checkProperty(fc, {
    name: "tsdown-vibe-declarations", rule, command: "node --test test/tsdown-declarations.property.test.mjs",
    arbitrary: shapes.filter(outsideKnownGaps), check, numRuns: 12, regressions
  })
})

// The sibling and a module body evaluate when imported, before any statement
// the module keeps. A moved declaration that runs code while the module loads
// therefore overtakes every kept statement above it: with `settings.root =
// "/etc/app"` kept and `export const banner = readFileSync(settings.root +
// "/banner.txt")` moved, the file was read before the root was set. The split
// type-checked and the module's declarations were identical, so nothing but a
// test of the load order saw it. The sibling split now refuses such a module,
// and the module-body split moves only the host operations, called in place.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { splitPlatform, splitPlatformToModule } from "../lib/platform.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")

const banner = readFileSync(new URL("./fixtures/vibelang-banner-load-order.ts", import.meta.url), "utf8")

test("the sibling split refuses an initializer that would run ahead of a kept statement above it", () => {
  const split = splitPlatform(banner, "src/Banner.ts", ts)
  assert.match(split.refused, /^src\/Banner\.ts: export const banner = readFileSync\(.* runs while the module loads, after settings\.root = "\/etc\/app", and in Banner\.platform\.ts it would run first$/)
})

test("the module-body split keeps the initializer below the statement and moves only its host call", () => {
  const split = splitPlatformToModule(banner, "src/Banner.ts", ts)
  assert.ok(!split.refused, split.refused)
  assert.deepEqual(split.moved, ["$readFileSync"])
  assert.deepEqual(split.kept, ["banner", "title"])
  const assigned = split.module.indexOf(`settings.root = "/etc/app"`), read = split.module.indexOf(`export const banner = $readFileSync(settings.root + "/banner.txt", "utf8")`)
  assert.ok(assigned >= 0 && read > assigned, split.module)
})

test("a host global read below a configuring call stays below it", () => {
  const text = `import { config } from "dotenv"\n\nconfig()\n\nexport const port = Number(process.env.PORT)\nexport const label = (n: number): string => "port " + n\n`
  assert.match(splitPlatform(text, "src/env.ts", ts, { globals: ["process"] }).refused, /export const port = .* runs while the module loads, after config\(\)/)
  const body = splitPlatformToModule(text, "src/env.ts", ts, { globals: ["process"] })
  assert.ok(!body.refused, body.refused)
  assert.ok(body.module.indexOf("\nconfig()\n") < body.module.indexOf("export const port = Number($process_env_PORT())"), body.module)
})

test("a kept declaration that calls at load, a block and a member read count as well", () => {
  // The configuring call is a declaration's initializer.
  const declared = `import { homedir } from "node:os"\nimport { configure } from "./setup.js"\n\nconst ready = configure()\nexport const home = homedir()\nexport const isReady = (): boolean => ready\n`
  assert.match(splitPlatform(declared, "src/home.ts", ts).refused, /export const home = homedir\(\) runs while the module loads, after const ready = configure\(\)/)
  // The directory is made inside an if the module keeps.
  const guarded = `import { EOL } from "node:os"\nimport { state, prepare } from "./setup.js"\n\nif (!state.ready) prepare()\n\nexport const ending = state.prefix + EOL\nexport const lines = (text: string): number => text.length\n`
  assert.match(splitPlatform(guarded, "src/lines.ts", ts).refused, /export const ending = state\.prefix \+ EOL runs while the module loads, after if \(!state\.ready\) prepare\(\)/)
  // A static initializer runs when the class is declared.
  const classed = `import { hostname } from "node:os"\nimport { registry } from "./setup.js"\n\nregistry.open()\n\nexport class Host {\n  static readonly name_ = registry.add(hostname())\n}\nexport const size = (): number => registry.size\n`
  assert.match(splitPlatform(classed, "src/host.ts", ts).refused, /export class Host \{ runs while the module loads, after registry\.open\(\)/)
})

test("throwing code that would move whole into a body ahead of a kept statement is refused", () => {
  const text = `import { decode, registry } from "./codec.js"\n\nregistry.strict = true\n\nexport const first = decode("a")\nexport const count = (): number => registry.size\n`
  const split = splitPlatformToModule(text, "src/first.ts", ts, { throws: true, throwing: ["decode"] })
  assert.match(split.refused, /^src\/first\.ts: export const first = decode\("a"\) runs while the module loads, after registry\.strict = true, and in a module body it would run first$/)
})

test("what cannot be overtaken still moves", () => {
  // The kept statement stands below the moved initializer: it ran after it, and still does.
  const below = `import { homedir } from "node:os"\nimport { settings } from "./settings.js"\n\nexport const home = homedir()\n\nsettings.home = home\nexport const title = (name: string): string => home + name\n`
  assert.deepEqual(splitPlatform(below, "src/home.ts", ts).moved, ["home"])
  assert.deepEqual(splitPlatformToModule(below, "src/home.ts", ts).moved, ["home"])
  // A stored function runs when called, not when the module loads.
  const stored = `import { readFileSync } from "node:fs"\nimport { settings } from "./settings.js"\n\nsettings.root = "/etc/app"\n\nexport const banner = (): string => readFileSync(settings.root + "/banner.txt", "utf8")\nexport const title = (name: string): string => banner() + name\n`
  assert.deepEqual(splitPlatform(stored, "src/Banner.ts", ts).moved, ["banner"])
  assert.deepEqual(splitPlatformToModule(stored, "src/Banner.ts", ts).moved, ["banner"])
  // Declarations that only store values run nothing a moved initializer can observe.
  const pure = `import { homedir } from "node:os"\n\nexport interface Options { readonly depth: number }\nexport const limit = 64\nexport const defaults = { depth: limit, names: ["a"] }\nexport function depth(o: Options): number { return o.depth }\nexport class Box { size = depth(defaults) }\n\nexport const home = homedir()\nexport const title = (name: string): string => home + name\n`
  assert.deepEqual(splitPlatform(pure, "src/home.ts", ts).moved, ["home"])
  assert.deepEqual(splitPlatformToModule(pure, "src/home.ts", ts).moved, ["home"])
})

test("implicit calls in kept initializers keep later host operations in place", () => {
  const initializers = [
    "settings.configure", 'settings["configure"]', "{ ...settings }", "[...iterable]",
    "+coercible", "coercible + 1", "`${coercible}`", "{ [coercible]: 1 }",
  ]
  for (const initializer of initializers) {
    const text = `import { homedir } from "node:os"\nimport { settings, iterable, coercible } from "./settings.js"\nexport const configured = ${initializer}\nexport const home = homedir()\nexport const label = () => configured\n`
    assert.match(splitPlatform(text, "src/Home.ts", ts).refused, /runs while the module loads/, initializer)
    const body = splitPlatformToModule(text, "src/Home.ts", ts)
    assert.ok(!body.refused, body.refused)
    assert.ok(body.module.indexOf("export const configured =") < body.module.indexOf("export const home = $homedir()"), body.module)
  }
  const destructured = `import { homedir } from "node:os"\nimport { settings } from "./settings.js"\nexport const { configure: configured } = settings\nexport const home = homedir()\nexport const label = () => configured\n`
  assert.match(splitPlatform(destructured, "src/Home.ts", ts).refused, /runs while the module loads/)
  // Class heritage and decorators run even though the method/field body does not.
  for (const declaration of [
    "export class Setup extends Base {}",
    "export class Setup { @configure method() {} }",
    "export class Setup { @configure field = 0 }",
    "export class Setup { static { throw failure } }",
  ]) {
    const text = `import { homedir } from "node:os"\nimport { Base, configure, failure } from "./settings.js"\n${declaration}\nexport const home = homedir()\nexport const label = () => Setup\n`
    assert.match(splitPlatform(text, "src/Home.ts", ts).refused, /runs while the module loads/, declaration)
  }
})

// Spec: docs/design/src/001-functions.md, `module` declarations:
// "It evaluates once, in import order, only when imported for a value."
// Neighbourhood: a module of statements that each record when they run. Some
// are kept (a call, an if, a declaration that calls, a stored function, a
// constant), some read the host at load or inside a stored function. Loaded as
// written and loaded after either split, the statements run in the same order,
// or the split refuses.
const kinds = {
  call: (i) => `mark("call${i}")`,
  guard: (i) => `if (mark("test${i}") === 0) mark("then${i}")`,
  declared: (i) => `export const d${i} = mark("declared${i}")`,
  privately: (i) => `const q${i} = mark("private${i}")\nexport const useQ${i} = (): number => q${i}`,
  getter: (i) => `export const getter${i} = settings.configure`,
  destructure: (i) => `export const { configure: configured${i} } = settings`,
  objectSpread: (i) => `export const object${i} = { ...settings }`,
  arraySpread: (i) => `export const array${i} = [...iterable]`,
  coerce: (i) => `export const number${i} = +coercible`,
  add: (i) => `export const sum${i} = coercible + 1`,
  constant: (i) => `export const c${i} = ${i}`,
  stored: (i) => `export const s${i} = (n: number): number => mark("stored${i}") + n`,
  host: (i) => `export const h${i} = mark("host${i}", hostname().length)`,
  hostRead: (i) => `export const r${i} = mark("read${i}") + EOL.length`,
  hostPrivate: (i) => `const p${i} = mark("hostPrivate${i}", hostname().length)\nexport const useP${i} = (): number => p${i}`,
  hostStored: (i) => `export const f${i} = (n: number): number => mark("hostStored${i}", hostname().length) + n`,
  global: (i) => `export const g${i} = mark("global${i}", process.pid)`,
}
const moduleOf = (names) => `import { EOL, hostname } from "node:os"\nimport { mark, settings, iterable, coercible } from "./trace.js"\n\n${names.map((name, i) => kinds[name](i)).join("\n")}\n`

const emit = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText

// Loads entry from files in a fresh directory and returns what ran, in order.
async function trace(files, entry) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-load-order-"))
  try {
    writeFileSync(join(root, "package.json"), `{ "type": "module" }\n`)
    writeFileSync(join(root, "trace.js"), `export const mark = (label, value = 0) => { globalThis.platformLoadOrderTrace.push(label); return value }
export const settings = { get configure() { return mark("configure") } }
export const iterable = { *[Symbol.iterator]() { yield mark("iterate") } }
export const coercible = { [Symbol.toPrimitive]() { return mark("coerce") } }\n`)
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text)
    globalThis.platformLoadOrderTrace = []
    await import(pathToFileURL(join(root, entry)).href)
    return globalThis.platformLoadOrderTrace
  } finally {
    delete globalThis.platformLoadOrderTrace
    rmSync(root, { recursive: true, force: true })
  }
}

// A body evaluates when the module imports it (VIP-40), as a sibling does, so
// it loads here as a file of its own.
function bodyFiles(module) {
  const match = /^module (\w+) \{\n([\s\S]*?)\n\}\n/m.exec(module)
  assert.ok(match, module)
  const rest = module.slice(0, match.index) + module.slice(match.index + match[0].length)
  return { "m.js": emit(rest.replace(new RegExp(` from ${match[1]}$`, "gm"), ` from "./m.body.js"`)), "m.body.js": emit(match[2]) }
}

test("the witness loads in its written order after the module-body split", async () => {
  const text = moduleOf(["call", "host", "stored"])
  const split = splitPlatformToModule(text, "src/m.ts", ts)
  assert.ok(!split.refused, split.refused)
  assert.deepEqual(await trace(bodyFiles(split.module), "m.js"), ["call0", "host1"])
})

test("statements run in their written order after either split", async () => {
  const names = fc.array(fc.constantFrom(...Object.keys(kinds)), { minLength: 2, maxLength: 7 })
  let split = 0
  await fc.assert(fc.asyncProperty(names, fc.boolean(), async (statements, globals) => {
    const text = moduleOf(statements)
    const options = { globals: globals ? ["process"] : [] }
    const written = await trace({ "m.js": emit(text) }, "m.js")
    const sibling = splitPlatform(text, "src/m.ts", ts, options)
    if (sibling && !sibling.refused) {
      split++
      const files = { "m.js": emit(sibling.module.replaceAll(`"./m.platform.ts"`, `"./m.platform.js"`)), "m.platform.js": emit(sibling.platform) }
      assert.deepEqual(await trace(files, "m.js"), written, text + "\n--- module\n" + sibling.module + "\n--- sibling\n" + sibling.platform)
    }
    const body = splitPlatformToModule(text, "src/m.ts", ts, options)
    if (body && !body.refused) {
      split++
      assert.deepEqual(await trace(bodyFiles(body.module), "m.js"), written, text + "\n--- module\n" + body.module)
    }
  }), { numRuns: 300, examples: [
    [["call", "host", "stored"], false],
    [["objectSpread", "hostRead", "call"], false],
    [["getter", "host", "stored"], false],
    [["arraySpread", "host", "stored"], false],
    [["destructure", "host", "stored"], false],
    [["coerce", "global", "stored"], true],
  ] })
  assert.ok(split > 100, `only ${split} modules split`)
})

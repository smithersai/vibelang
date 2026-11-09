import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import { unplugin } from "../src/index.js"

const quote = "A `.vibex` file is a `.vibe` file read with TypeScript's JSX language variant."
const frameworks = ["vite", "rollup", "rolldown", "webpack", "rspack", "esbuild"]
const hooks = frameworks.map(framework => [framework, unplugin.raw({}, { framework }).loadInclude])

test("VIP-39 bundler source oracle quotes the file-kind contract", () => {
  assert.ok(readFileSync(SpecPath("../vips/0039-vibex.md"), "utf8").includes(quote))
})

test("VIP-39 actual loadInclude accepts the JSX source witness", () => {
  for (const [framework, include] of hooks) {
    assert.equal(include("/app/Card.vibex"), true, framework)
    assert.equal(include("/app/Card.vibex?import"), true, framework)
    assert.equal(include("/app/Card.vibe"), true, framework)
    for (const suffix of [".tsx", ".js", ".d.vibex.ts", ".vibex.map", ".vibexx"]) {
      assert.equal(include("/app/Card" + suffix), false, framework + suffix)
    }
  }
})

test("VIP-39 generated module IDs retain source suffix boundaries before queries", () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom("a", "Z", "0", "雪", " ", ".", "-", "_"), { minLength: 1, maxLength: 24 }),
    fc.constantFrom("src/", "/app/", "/nested/components/", "C:/app/"),
    fc.constantFrom(".vibe", ".vibex", ".tsx", ".d.vibex.ts", ".vibex.map", ".vibexx"),
    fc.constantFrom("", "?import", "?v=1", "?raw&file=Other.vibex", "?file=Other.vibe"),
    (letters, directory, suffix, query) => {
      const id = directory + letters.join("") + suffix + query
      const expected = suffix === ".vibe" || suffix === ".vibex"
      for (const [framework, include] of hooks) assert.equal(include(id), expected, framework + ": " + id)
    }
  ), { numRuns: 400, seed: 391239 })
})

test("esbuild builds explicit JSX sources and module queries like TypeScript JSX", async () => {
  const { mkdir, mkdtemp, readFile, rm, symlink, writeFile } = await import("node:fs/promises")
  const { spawnSync } = await import("node:child_process")
  const { join } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const { build } = await import("esbuild")
  const plugin = (await import("../src/esbuild.js")).default
  const { checkProperty } = await import("../../../scripts/testing/property.mjs")
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
  async function check({ name, jsx, query, label, value, inherited = false, override = false, hostTransform = true }) {
    const parent = join(repo, "packages/unplugin/test/.fixtures")
    await mkdir(parent, { recursive: true })
    const fixture = await mkdtemp(join(parent, "jsx-source-"))
    try {
      for (const kind of ["typescript", "vibelang"]) {
        const root = join(fixture, kind), extension = kind === "typescript" ? ".tsx" : ".vibex"
        await mkdir(join(root, "src"), { recursive: true })
        await mkdir(join(root, "node_modules"))
        await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
        await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
        await writeFile(join(root, "package.json"), '{"type":"module"}')
        const config = {
          compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], jsx, jsxFactory: "h", rewriteRelativeImportExtensions: true },
          include: ["src"]
        }
        if (inherited) {
          await writeFile(join(root, "base.json"), JSON.stringify({ compilerOptions: { jsxFactory: "h" } }))
          config.extends = "./base.json"
          delete config.compilerOptions.jsxFactory
        }
        await writeFile(join(root, "tsconfig.json"), JSON.stringify(config))
        await writeFile(join(root, "src/jsx.d.ts"), "declare namespace JSX { interface IntrinsicElements { span: { children?: unknown } } }\n")
        const customFactory = override && jsx === "preserve"
        const child = `function h(tag: string, _props: unknown, ...children: unknown[]) { return {tag,children: ${customFactory ? "[]" : "children"}} }\n`
          + (customFactory ? 'function g(tag: string, _props: unknown, ...children: unknown[]) { return {tag,children} }\n' : "")
          + `export function child() { return (<span>{${JSON.stringify(label)}}</span>).children[0] }\n`
        const source = `import {child} from "./Child${extension}"\nexport const value: number = child() === ${JSON.stringify(label)} ? ${value} : 0\nexport function explode() { return (null as unknown as string).toUpperCase() }\n`
        await writeFile(join(root, "src/Child" + extension), child)
        await writeFile(join(root, "src", name + extension), source)
        const entry = join(root, "src/entry.mjs"), output = join(root, "out/main.mjs")
        await writeFile(entry, `import {value,explode} from ${JSON.stringify("./" + name + extension + query)}; if(process.env.MAP_WITNESS) explode(); console.log(value)\n`)
        await build({
          absWorkingDir: root, entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: output,
          ...(hostTransform ? { jsx: "transform" } : {}), ...(customFactory ? { jsxFactory: "g" } : {}), sourcemap: true, logLevel: "silent",
          plugins: kind === "typescript" ? [] : [plugin({ root, compiler })]
        })
        const result = spawnSync(process.execPath, [output], { encoding: "utf8" })
        assert.equal(result.status, 0, result.stderr)
        assert.equal(result.stdout.trim(), String(customFactory ? 0 : value), kind)
        if (kind === "vibelang") {
          const map = JSON.parse(await readFile(output + ".map", "utf8"))
          const index = map.sources.findIndex(path => {
            if (path.endsWith(name + extension)) return true
            try { return decodeURI(path).endsWith(name + extension) } catch { return false }
          })
          assert.ok(index >= 0, JSON.stringify(map.sources))
          assert.equal(map.sourcesContent[index], source)
          const stack = spawnSync(process.execPath, ["--enable-source-maps", output], { encoding: "utf8", env: { ...process.env, MAP_WITNESS: "1" } })
          assert.notEqual(stack.status, 0)
          const column = source.split("\n")[2].indexOf("toUpperCase") + 1
          assert.ok(stack.stderr.includes(name + extension + ":3:" + column), stack.stderr)
        }
      }
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  }
  for (const jsx of ["react", "preserve"]) await check({ name: "créé %20", jsx, query: "?v=1", label: "資料", value: 42 })
  await check({ name: "Default", jsx: "preserve", query: "", label: "hello", value: 44, hostTransform: false })
  await check({ name: "Override", jsx: "preserve", query: "?import", label: "hello", value: 43, inherited: true, override: true })
  await checkProperty(fc, {
    name: "esbuild-jsx-source",
    rule: "VIP-39: " + quote,
    arbitrary: fc.record({
      name: fc.array(fc.constantFrom("a", "é", "日", " ", "%", "2", "0"), { minLength: 1, maxLength: 8 }).map(chars => "View-" + chars.join("")),
      jsx: fc.constantFrom("react", "preserve"), query: fc.constantFrom("", "?import", "?v=1"),
      label: fc.constantFrom("hello", "資料", "😀"), value: fc.integer({ min: 3, max: 100 }),
      inherited: fc.boolean(), override: fc.boolean(), hostTransform: fc.boolean()
    }),
    numRuns: 20, check,
    command: "node --test test/vibex-load-include.test.mjs"
  })
})

for (const mode of ["ignores termination", "leaves inherited pipes"]) {
  test(`JSX configuration queries close when a compiler ${mode}`, async () => {
    const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { jsxConfigReader } = await import("../src/jsx-config.js")
    const root = await mkdtemp(join(tmpdir(), "jsx-config-close-")), script = join(root, "compiler.mjs"), ready = join(root, "ready")
    await writeFile(script, `
import {writeFileSync} from "node:fs"
${mode === "ignores termination" ? 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)' : 'import {spawn} from "node:child_process";spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"})'}
writeFileSync(${JSON.stringify(ready)}, "ready")
${mode === "leaves inherited pipes" ? "process.exit(3)" : ""}
`)
    const reader = jsxConfigReader({ compiler: script, compilerCommand: (file, args) => [process.execPath, [file, ...args]] })
    const pending = reader.read(join(root, "tsconfig.json"))
    // Observe rejection immediately while the close operation terminates it.
    const observed = pending.then(value => ({ value }), error => ({ error }))
    try {
      const deadline = Date.now() + 10000
      let started = false
      while (!started && Date.now() < deadline) {
        started = await readFile(ready, "utf8").then(() => true, () => false)
        if (!started) await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.equal(started, true, "the metadata compiler starts")
      await reader.close()
      assert.match((await observed).error?.message ?? "", /closed/)
      await reader.close()
    } finally {
      await reader.close()
      await rm(root, { recursive: true, force: true })
    }
  })
}

test("JSX output resolution preserves competing TypeScript source priority", async () => {
  const { mkdir, mkdtemp, rm, symlink, writeFile } = await import("node:fs/promises")
  const { spawnSync } = await import("node:child_process")
  const { join } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const { build } = await import("esbuild")
  const plugin = (await import("../src/esbuild.js")).default
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
  for (const specifier of ["./Child.js", "./Child.vibex"]) {
    const root = await mkdtemp(join(repo, "packages/unplugin/test/.fixtures/jsx-priority-"))
    try {
      await mkdir(join(root, "node_modules"))
      await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
      await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
      await writeFile(join(root, "package.json"), '{"type":"module"}')
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], jsx: "react", rewriteRelativeImportExtensions: true },
        files: ["main.vibe"]
      }))
      await writeFile(join(root, "Child.tsx"), "export const value = 42\n")
      await writeFile(join(root, "Child.vibex"), "export const value = 7\n")
      await writeFile(join(root, "main.vibe"), `import {value} from ${JSON.stringify(specifier)}\nexport {value}\n`)
      await writeFile(join(root, "entry.mjs"), 'import {value} from "./main.vibe";console.log(value)\n')
      const output = join(root, "out.mjs")
      await build({ absWorkingDir: root, entryPoints: ["entry.mjs"], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [plugin({ root, compiler })] })
      const run = spawnSync(process.execPath, [output], { encoding: "utf8" })
      assert.equal(run.status, 0, run.stderr)
      assert.equal(run.stdout.trim(), specifier.endsWith(".js") ? "42" : "7", specifier)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

for (const framework of ["rollup", "webpack", "rspack"]) test(framework + " builds queried JSX entry and rewritten JSX dependencies", async () => {
  const { mkdir, mkdtemp, readFile, rm, symlink, writeFile } = await import("node:fs/promises")
  const { spawnSync } = await import("node:child_process")
  const { join } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const { rollup } = await import("rollup")
  const plugin = (await import("../src/rollup.js")).default
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
  const root = await mkdtemp(join(repo, "packages/unplugin/test/.fixtures/rollup-jsx-"))
  let bundle
  try {
    await mkdir(join(root, "node_modules"))
    await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
    await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], jsx: "react", jsxFactory: "h", rewriteRelativeImportExtensions: true }, include: ["*.vibex", "*.d.ts"] }))
    await writeFile(join(root, "jsx.d.ts"), "declare namespace JSX { interface IntrinsicElements { span: { children?: unknown } } }\n")
    await writeFile(join(root, "Child.vibex"), 'function h(tag: string, _props: unknown, ...children: unknown[]) { return {tag,children} }\nexport const value = (<span>hello</span>).tag === "span" ? 42 : 0\n')
    const source = 'import {value} from "./Child.vibex"\nexport {value}\nexport function explode() { return (null as unknown as string).toUpperCase() }\n'
    await writeFile(join(root, "View.vibex"), source)
    await writeFile(join(root, "entry.mjs"), 'import {value,explode} from "./View.vibex?v=1";if(process.env.MAP_WITNESS) explode();console.log(value)\n')
    const output = join(root, framework === "rollup" ? "out.mjs" : "out.cjs")
    if (framework === "rollup") {
      bundle = await rollup({ input: join(root, "entry.mjs"), plugins: [plugin({ root, compiler })] })
      await bundle.write({ file: output, format: "esm", sourcemap: true })
    } else {
      const nativePlugin = (await import("../src/" + framework + ".js")).default
      const api = framework === "webpack" ? (await import("webpack")).default : (await import("@rspack/core")).rspack
      const instance = api({ context: root, mode: "none", target: "node", entry: join(root, "entry.mjs"), devtool: "source-map", output: { path: root, filename: "out.cjs" }, plugins: [nativePlugin({ root, compiler })], infrastructureLogging: { level: "error" } })
      bundle = { close: () => new Promise((accept, reject) => instance.close(error => error ? reject(error) : accept())) }
      await new Promise((accept, reject) => instance.run((error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : accept()))
    }
    const run = spawnSync(process.execPath, [output], { encoding: "utf8" })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout.trim(), "42")
    const map = JSON.parse(await readFile(output + ".map", "utf8"))
    assert.equal(map.sourcesContent[map.sources.findIndex(path => path.endsWith("View.vibex"))], source)
    const stack = spawnSync(process.execPath, ["--enable-source-maps", output], { encoding: "utf8", env: { ...process.env, MAP_WITNESS: "1" } })
    assert.notEqual(stack.status, 0)
    assert.ok(stack.stderr.includes("View.vibex:3:" + (source.split("\n")[2].indexOf("toUpperCase") + 1)), stack.stderr)
  } finally { await bundle?.close(); await rm(root, { recursive: true, force: true }) }
})

test("Bun registers both VibeLang source kinds without matching lookalikes", () => {
  let hook
  unplugin.raw({}, { framework: "bun" }).bun.setup({
    config: {}, onResolve() {}, onLoad(options, load) { hook = { ...options, load } }
  })
  assert.ok(hook)
  fc.assert(fc.property(
    fc.constantFrom("src/", "/components/", "C:/app/"),
    fc.array(fc.constantFrom("a", "Z", "0", "雪", " ", "-", "_"), { minLength: 1, maxLength: 16 }),
    fc.constantFrom(".vibe", ".vibex", ".vibex.map", ".vibexx", ".d.vibex.ts", ".tsx"),
    fc.constantFrom("", "?import", "?v=1"),
    (directory, letters, suffix, query) => {
      assert.equal(hook.filter.test(directory + letters.join("") + suffix + query),
        suffix === ".vibe" || suffix === ".vibex")
    }
  ), { numRuns: 120, seed: 480739 })
})

test("Bun builds JSX module named exports like native TypeScript JSX", async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises")
  const { spawnSync } = await import("node:child_process")
  const { join } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const root = fileURLToPath(new URL("./.fixtures/", import.meta.url))
  await mkdir(root, { recursive: true })
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-prompt-history-vibex.json", import.meta.url), "utf8"))
  async function check({ name, jsx, value, label }) {
    const fixture = await mkdtemp(join(root, "bun-vibex-"))
    try {
      await mkdir(join(fixture, "src"))
      await writeFile(join(fixture, "package.json"), '{"type":"module"}')
      await writeFile(join(fixture, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
          strict: true, skipLibCheck: true, types: [], jsx, jsxFactory: "h",
          allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true }, include: ["src"]
      }))
      await writeFile(join(fixture, "src/jsx.d.ts"),
        "declare namespace JSX { interface IntrinsicElements { span: {children?: unknown} } }")
      const source = 'function h(tag: string, _props: unknown, ...children: unknown[]) { return {tag, children} }\n'
        + 'export function emptyPrompt() { return ' + JSON.stringify(value) + ' }\n'
        + 'export function view() { return (<span>{' + JSON.stringify(label) + '}</span>).children[0] }\n'
      for (const extension of [".tsx", ".vibex"])
        await writeFile(join(fixture, "src", name + (extension === ".tsx" ? "-native" : "-vibe") + extension), source)
      const buildSource = [
        'import assert from "node:assert/strict"',
        'import vibelang from "vibelang-unplugin/bun"',
        'for (const extension of [".tsx", ".vibex"]) {',
        'const result = await Bun.build({entrypoints:["./src/entry" + extension + ".ts"],target:"bun",jsx:{runtime:"classic",factory:"h"},plugins:extension === ".vibex" ? [vibelang({root:process.cwd()})] : []})',
        'assert.equal(result.success, true, result.logs.map(String).join("\\n"))',
        'const output = "./out" + extension + ".mjs"',
        'await Bun.write(output, result.outputs[0])',
        'const loaded = await import(output)',
        'assert.equal(loaded.emptyPrompt(), ' + JSON.stringify(value) + ')',
        'assert.equal(loaded.view(), ' + JSON.stringify(label) + ')',
        '}'
      ].join("\n")
      await writeFile(join(fixture, "build.ts"), buildSource)
      for (const extension of [".tsx", ".vibex"])
        await writeFile(join(fixture, "src", "entry" + extension + ".ts"),
          'export {emptyPrompt, view} from ' + JSON.stringify("./" + name + (extension === ".tsx" ? "-native" : "-vibe") + extension) + "\n")
      const result = spawnSync("bun", ["run", "build.ts"], {
        cwd: fixture, encoding: "utf8", timeout: 120000,
        env: {...process.env, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(fixture, ".cache")}
      })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stdout + "\n" + result.stderr)
    } finally { await rm(fixture, {recursive: true, force: true}) }
  }
  await check({name: "history", jsx: corpus.jsx, value: corpus.expected, label: "prompt"})
  await fc.assert(fc.asyncProperty(
    fc.record({name: fc.constantFrom("View", "with space", "雪-view"), jsx: fc.constantFrom("react", "preserve"),
      value: fc.integer({min: -50, max: 50}), label: fc.constantFrom("hello", "資料", "😀")}), check
  ), {numRuns: 8, seed: 480740})
})

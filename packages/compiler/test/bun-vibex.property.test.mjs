import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const preload = fileURLToPath(new URL("../bun.mjs", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-vibex-preload.json", import.meta.url)))
const skip = spawnSync("bun", ["--version"]).status !== 0 ? "Bun required" :
  spawnSync(compiler, ["--version"]).status !== 0 && "build the compiler"

// VIP-39 requires JSX scanning, checking and emit to match the TSX twin.
function check({ form, jsx, dynamic = false, body = false, value = 7 }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibex-preload-")))
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  try {
    put("package.json", '{"type":"module"}')
    put("tsconfig.json", JSON.stringify({
      compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler",
        jsx, jsxFactory: "h", strict: true, noEmit: true, types: [], skipLibCheck: true,
        allowImportingTsExtensions: true, paths: { "@view": ["./src/leaf.vibex"] } },
      vibe: { effectModules: false, effectGlobals: false }, include: ["src"]
    }))
    const code = "/** @jsxRuntime classic */\n/** @jsx h */\nfunction h(tag: string, props: unknown, ...children: unknown[]) { return children[0] }\nexport const value = <span>{" + value + "}</span>\n"
    put("src/jsx.d.ts", "declare namespace JSX { interface IntrinsicElements { span: unknown } }\n")
    put("src/leaf.vibex", body ? "module host {\n" + code + "}\nexport { value } from host\n" : code)
    put("src/dir/index.vibex", code)
    put("src/twin.tsx", code)
    const specifier = corpus.forms[form]
    const run = (name, loaded) => {
      put("main.ts", (dynamic ? "const { value } = await import(" + JSON.stringify(name) + ")" :
        "import { value } from " + JSON.stringify(name)) + "\nconsole.log(value)\n")
      return spawnSync("bun", [...(loaded ? ["--preload", preload] : []), "main.ts"], {
        cwd: root, encoding: "utf8", timeout: 60000,
        env: { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, "cache") }
      })
    }
    const expected = run("./src/twin.tsx", false)
    assert.equal(expected.status, 0, expected.stderr)
    const actual = run(specifier, true)
    assert.equal(actual.status, 0, JSON.stringify({ form, jsx, dynamic, body }) + "\n" + actual.stderr)
    assert.equal(actual.stdout, expected.stdout)
    assert.equal(actual.stdout, value + "\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Bun loads the opencode Vibex import forms with native TSX results", { skip }, () => {
  for (const form of Object.keys(corpus.forms)) check({ form, jsx: "preserve" })
  for (const jsx of ["preserve", "react", "react-native"]) check({ form: "explicit", jsx, body: true })
  check(JSON.parse(readFileSync(new URL("./corpus/opencode-vibex-native-jsx.json", import.meta.url))))
})

test("Bun Vibex imports preserve JSX modes, values and dynamic edges", { skip }, async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    form: fc.constantFrom(...Object.keys(corpus.forms)),
    jsx: fc.constantFrom("preserve", "react", "react-native"),
    dynamic: fc.boolean(), body: fc.boolean(), value: fc.integer({ min: -100, max: 100 })
  }), check), { numRuns: 18 })
})

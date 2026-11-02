import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(packageRoot, "native/vibelang")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const readmeQuote = "Set `VIBELANG_PROJECT` to a tsconfig path to\nchoose another project, such as `tsconfig.test.json` for an example beside a\nlibrary; it compiles the modules in its directory, and a module of another\nworkspace package, such as a dependency linked to its source, still compiles\nwith that package's own `tsconfig.json`."
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/opencode-script-outside-project.json", import.meta.url), "utf8"))
const chapterQuote = "**Existing tools work.**"

function check(input) {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(chapterQuote))
  assert.ok(readFileSync(join(packageRoot, "README.md"), "utf8").includes(readmeQuote))
  assert.ok(existsSync(native), "build the native compiler before loader properties")
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibe-script-project-")))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
    symlinkSync(packageRoot, join(root, "node_modules/vibelang"))
    put("package.json", '{"type":"module"}\n')
    const script = "script/" + "nested/".repeat(input.depth) + "run.vibe"
    const specifier = relative(dirname(script), "src/greet.vibe").split(String.fromCharCode(92)).join("/")
    const options = { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", noEmit: true, allowArbitraryExtensions: true, types: [], skipLibCheck: true }
    const files = input.files ?? {
      "src/greet.vibe": 'export const greet = (name: string): string => "hi " + name\n',
      [script]: "import { greet } from " + JSON.stringify(specifier) + "\nconst message: string = greet(" + JSON.stringify(input.value) + ")\n",
      "tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src"] }) + "\n"
    }
    for (const [file, text] of Object.entries(files)) {
      if (file === "tsconfig.json" && input.mode === "none") continue
      put(file, text)
      if (file.endsWith(".vibe")) put("native/" + file.replace(/\.vibe$/, ".ts"), text.replaceAll(".vibe", ".ts"))
    }
    put("entry.ts", 'import "./' + script + '"; console.log("loaded")\n')
    put("native/entry.ts", 'import "./' + script.replace(/\.vibe$/, ".ts") + '"; console.log("loaded")\n')
    const selected = { ...(input.mode === "excluded" ? { extends: "./tsconfig.json" } : { compilerOptions: options }), include: ["src", "script"] }
    // A custom-named config is never selected implicitly.
    put(input.config, JSON.stringify(selected) + "\n")
    for (const [backend, command, flags] of [
      ["node", process.execPath, ["--import", join(packageRoot, "register.mjs")]],
      ["bun", "bun", ["--preload", join(packageRoot, "bun.mjs")]]
    ]) {
      const run = (entry, preload, project = "") => {
        const r = spawnSync(command, [...preload, entry], {
          cwd: root, encoding: "utf8", timeout: 20000,
          env: { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: project, VIBELANG_CACHE_DIR: join(root, ".cache-" + backend), NO_COLOR: "1" }
        })
        assert.ifError(r.error)
        assert.equal(r.signal, null)
        return r
      }
      const nativeControl = run("native/entry.ts", [])
      assert.equal(nativeControl.status, 0, backend + ": native TypeScript control: " + nativeControl.stderr)
      assert.equal(nativeControl.stdout, "loaded\n")
      const rejected = run("entry.ts", flags)
      assert.notEqual(rejected.status, 0, backend + ": no implicit project synthesis")
      assert.match(rejected.stdout + rejected.stderr, input.mode === "none" ? /no tsconfig\.json above/ : /does not include .*run\.vibe; set VIBELANG_PROJECT/)
      const accepted = run("entry.ts", flags, join(root, input.config))
      assert.equal(accepted.status, 0, backend + ": explicitly selected project: " + accepted.stderr)
      assert.equal(accepted.stdout, "loaded\n")
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode-28: original excluded script uses an explicit including project", () => check(corpus))
test("loaders retain the project contract across nesting, names, missing configs and values", () => {
  fc.assert(fc.property(fc.record({
    mode: fc.constantFrom("none", "excluded"),
    depth: fc.integer({ min: 0, max: 3 }),
    config: fc.constantFrom("tsconfig.scripts.json", "tsconfig.tools.json"),
    value: fc.constantFrom("script", "generate", "with space", "λ")
  }), check), { seed: 281103, numRuns: 8, endOnFailure: true })
})

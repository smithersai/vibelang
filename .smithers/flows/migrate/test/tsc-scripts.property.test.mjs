// opencode-42: packages/http-recorder's script/build.ts runs
// $`bunx tsc --emitDeclarationOnly` and then reads dist/index.d.ts; stock tsc
// reads no .vibe file, so once src/index.ts became .vibe the build failed.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { replaceTscInScript, wireBunBuilds } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

test("opencode-42: the build script's Bun shell runs vibelang where it ran tsc, and setup writes it", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-http-recorder-build.json", import.meta.url), "utf8"))
  assert.equal(replaceTscInScript(corpus.before, ts), corpus.after)
  assert.equal(replaceTscInScript(corpus.after, ts), corpus.after)
  const root = mkdtempSync(join(tmpdir(), "migrate-tsc-scripts-"))
  try {
    const files = {
      "package.json": JSON.stringify({ name: "opencode", private: true, workspaces: ["packages/*"] }),
      "packages/http-recorder/package.json": JSON.stringify({ name: "@opencode/http-recorder", scripts: { build: "bun ./script/build.ts" }, devDependencies: { "vibelang-unplugin": "x", vibelang: "x" } }),
      "packages/http-recorder/script/build.ts": corpus.before,
      "packages/http-recorder/src/index.vibe": "export const a = 1\n"
    }
    for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    const wired = wireBunBuilds({ root, packages: [{ dir: "packages/http-recorder" }], ts, specsFor: () => ({ vibelang: "x", "vibelang-unplugin": "x" }) })
    assert.ok(wired.changed.includes("packages/http-recorder/script/build.ts"), JSON.stringify(wired))
    assert.equal(readFileSync(join(root, "packages/http-recorder/script/build.ts"), "utf8"), corpus.after)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("opencode-47: a build script that only runs tsc runs vibelang, and its package gets vibelang", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-codemode-build.json", import.meta.url), "utf8"))
  assert.equal(replaceTscInScript(corpus.before, ts), corpus.after)
  const root = mkdtempSync(join(tmpdir(), "migrate-tsc-scripts-"))
  try {
    const files = {
      "package.json": JSON.stringify({ name: "opencode", private: true, workspaces: ["packages/*"] }),
      "packages/codemode/package.json": JSON.stringify({ name: "@opencode/codemode", files: ["dist"], scripts: { build: "bun run script/build.ts" } }),
      "packages/codemode/script/build.ts": corpus.before,
      "packages/codemode/script/notes.ts": 'const help = "run tsc by hand"\n',
      "packages/codemode/src/codemode.vibe": "export const a = 1\n"
    }
    for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    const wire = () => wireBunBuilds({ root, packages: [{ dir: "packages/codemode" }], ts, specsFor: () => ({ vibelang: "file:vibelang.tgz" }) })
    const wired = wire()
    assert.deepEqual(wired.changed.sort(), ["packages/codemode/package.json", "packages/codemode/script/build.ts"], JSON.stringify(wired))
    assert.deepEqual(wired.builds, [])
    assert.equal(readFileSync(join(root, "packages/codemode/script/build.ts"), "utf8"), corpus.after)
    assert.equal(readFileSync(join(root, "packages/codemode/script/notes.ts"), "utf8"), files["packages/codemode/script/notes.ts"])
    assert.deepEqual(JSON.parse(readFileSync(join(root, "packages/codemode/package.json"), "utf8")).devDependencies, { vibelang: "file:vibelang.tgz" })
    assert.deepEqual(wire().changed, [], "a second setup changes nothing")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Generated build scripts: tsc in command position in $ templates (alone,
// through a runner, after a separator, beside an interpolation), and decoys
// that must stay: tsconfig words, tscx, tsc in an ordinary string, a comment,
// an interpolated value, another tag.
const runner = fc.constantFrom("", "bunx ", "npx ", "pnpm exec ", "bun x ", "bun ", "yarn ")
const flags = fc.constantFrom("", " --emitDeclarationOnly", " -p tsconfig.build.json", " -b")
const command = fc.tuple(runner, flags).map(([r, f]) => `${r}tsc${f}`)
const site = fc.constantFrom(
  (c) => [`await $\`${c}\``, true],
  (c) => [`await $\`rm -rf dist && ${c}\``, true],
  (c) => [`await $\`${c} --outDir \${out}\``, true],
  (c) => [`const x = "${c}"`, false],
  (c) => [`// ${c}`, false],
  (c) => [`await sh\`${c}\``, false],
  (c) => [`await $\`echo tsconfig.json tscx\``, false]
)
test("tsc-in-scripts: only tsc in command position of a $ template becomes vibelang", () => {
  fc.assert(fc.property(fc.array(fc.tuple(command, site), { minLength: 1, maxLength: 5 }), (lines) => {
    const built = lines.map(([c, s]) => s(c))
    const text = 'import { $ } from "bun"\nconst out = "dist"\n' + built.map(([line]) => line).join("\n") + "\n"
    const expected = 'import { $ } from "bun"\nconst out = "dist"\n' + built.map(([line, changes], i) => changes ? line.replace(/((?:bunx|npx|pnpm exec|bun x|bun|yarn) )?tsc(?=[\s`])/, "$1vibelang") : line).join("\n") + "\n"
    const result = replaceTscInScript(text, ts)
    assert.equal(result, expected)
    assert.equal(replaceTscInScript(result, ts), result)
  }), { seed: 42042, numRuns: 300 })
})

// Generated packages whose build scripts have no Bun.build: setup rewrites a
// script exactly when its Bun shell runs tsc, to replaceTscInScript's text,
// gives the package vibelang once, and a second setup changes nothing.
test("tsc-only-scripts: setup rewrites exactly the build scripts whose Bun shell runs tsc (opencode-47)", () => {
  fc.assert(fc.property(fc.array(fc.array(fc.tuple(command, site), { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 3 }), fc.boolean(), (scripts, hasVibelang) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-tsc-only-"))
    try {
      const texts = scripts.map((lines) => 'import { $ } from "bun"\nconst out = "dist"\n' + lines.map(([c, s]) => s(c)[0]).join("\n") + "\n")
      const manifest = { name: "@demo/lib", ...(hasVibelang ? { devDependencies: { vibelang: "mine" } } : {}) }
      const files = {
        "package.json": JSON.stringify({ name: "demo", private: true, workspaces: ["packages/*"] }),
        "packages/lib/package.json": JSON.stringify(manifest),
        "packages/lib/src/a.vibe": "export const a = 1\n",
        ...Object.fromEntries(texts.map((text, i) => [`packages/lib/script/build${i}.ts`, text]))
      }
      for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
      const wire = () => wireBunBuilds({ root, packages: [{ dir: "packages/lib" }], ts, specsFor: () => ({ vibelang: "file:vibelang.tgz" }) })
      const wired = wire()
      const rewritten = texts.map((text, i) => [`packages/lib/script/build${i}.ts`, replaceTscInScript(text, ts)]).filter(([, after], i) => after !== texts[i])
      for (const [file, after] of rewritten) assert.equal(readFileSync(join(root, file), "utf8"), after)
      texts.forEach((text, i) => { if (!rewritten.some(([f]) => f === `packages/lib/script/build${i}.ts`)) assert.equal(readFileSync(join(root, `packages/lib/script/build${i}.ts`), "utf8"), text) })
      const manifestChanged = rewritten.length > 0 && !hasVibelang
      assert.deepEqual(wired.changed.sort(), [...rewritten.map(([f]) => f), ...(manifestChanged ? ["packages/lib/package.json"] : [])].sort())
      assert.deepEqual(JSON.parse(readFileSync(join(root, "packages/lib/package.json"), "utf8")).devDependencies, hasVibelang ? { vibelang: "mine" } : manifestChanged ? { vibelang: "file:vibelang.tgz" } : undefined)
      assert.deepEqual(wired.builds, [])
      assert.deepEqual(wire().changed, [], "a second setup changes nothing")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 47047, numRuns: 150 })
})

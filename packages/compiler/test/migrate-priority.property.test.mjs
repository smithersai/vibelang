import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { renameBatch, restoreExports, rewriteExports } from "../../../.smithers/flows/migrate/lib/codemod.mjs"
import { loadTypeScript } from "../../../.smithers/flows/migrate/lib/declarations.mjs"
import { addBunBuildPlugin } from "../../../.smithers/flows/migrate/lib/wire.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const regressions = new URL("./property-regressions/", import.meta.url)
const hasBun = spawnSync("bun", ["--version"]).status === 0
const rule = 'docs/design/src/007-tooling.md: "Existing tools work." and "Bundler plugins use the same names"'
let diagnostics = ""

test("migration property oracles quote the current tooling contract", () => {
  const chapter = readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8")
  for (const quote of ["Existing tools work.", "Bundler plugins use the same names"]) {
    assert.ok(chapter.includes(quote), "tooling specification changed: " + quote)
  }
})

function namesOf(input) {
  return Array.from({ length: input.count }, (_, i) =>
    (input.nested && i % 2 ? "effect/" : "") + (i === 0 ? "bom" : i === 1 ? "other" : "leaf" + i))
}

function manifestOf(input) {
  const target = "./src/*.ts"
  return {
    name: "lib", type: "module", description: "preserve unrelated metadata",
    exports: { "./*": input.style === "conditions"
      ? { types: "./dist/*.d.ts", bun: target, default: target }
      : input.style === "array" ? [target, "./fallback/*.js"] : target },
    main: "./src/bom.ts"
  }
}

function exportFiles(input) {
  return {
    "package.json": '{"type":"module"}\n',
    "packages/lib/package.json": JSON.stringify(manifestOf(input), null, 2) + "\n",
    ...Object.fromEntries(namesOf(input).map(name =>
      ["packages/lib/src/" + name + ".ts", "export const value = 42\n"]))
  }
}

test("migration package exports reach each renamed module and revert independently (opencode-3)", {
  skip: !hasBun && "bun is not on PATH"
}, async () => {
  await checkProperty(fc, {
    name: "migrate-package-exports", rule, regressions, numRuns: 50,
    command: "node --test test/migrate-priority.property.test.mjs",
    arbitrary: fc.record({
      count: fc.integer({ min: 2, max: 6 }), moved: fc.integer({ min: 1, max: 5 }),
      nested: fc.boolean(), style: fc.constantFrom("plain", "conditions", "array")
    }), artifacts: exportFiles, diagnostics: () => diagnostics,
    check: input => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-exports-property-")))
      try {
        for (const [file, contents] of Object.entries(exportFiles(input))) {
          mkdirSync(dirname(join(root, file)), { recursive: true })
          writeFileSync(join(root, file), contents)
        }
        mkdirSync(join(root, "node_modules"))
        symlinkSync("../packages/lib", join(root, "node_modules/lib"))
        const names = namesOf(input)
        const moved = names.slice(0, Math.min(input.moved, names.length - 1))
        const paths = moved.map(name => "packages/lib/src/" + name + ".ts")
        const renames = renameBatch(root, paths)
        const edits = rewriteExports(root, renames)
        const manifest = join(root, "packages/lib/package.json")
        const read = () => JSON.parse(readFileSync(manifest, "utf8"))
        assert.deepEqual(rewriteExports(root, renames), [], "a second rewrite is idempotent")
        assert.deepEqual(read().exports["./*"], manifestOf(input).exports["./*"], "unmigrated modules keep the pattern")
        const resolveAll = () => {
          const script = "console.log(JSON.stringify(" + JSON.stringify(names) +
            ".map(name => Bun.resolveSync('lib/' + name, process.cwd()))))"
          const result = spawnSync("bun", ["-e", script], {
            cwd: root, encoding: "utf8", timeout: 20000, env: { ...process.env, NO_COLOR: "1" }
          })
          diagnostics = JSON.stringify({ input, manifest: read(), result }).replaceAll(root, "<project>")
          assert.ifError(result.error)
          assert.equal(result.status, 0, diagnostics)
          return JSON.parse(result.stdout)
        }
        const expected = (remaining) => names.map(name =>
          join(root, "packages/lib/src/" + name + (remaining.includes(name) ? ".vibe" : ".ts")))
        assert.deepEqual(resolveAll(), expected(moved), diagnostics)
        for (let i = 0; i < paths.length; i++) {
          restoreExports(root, edits, paths[i])
          renameSync(join(root, renames[i].to), join(root, renames[i].from))
          assert.deepEqual(resolveAll(), expected(moved.slice(i + 1)), diagnostics)
        }
        assert.deepEqual(read(), manifestOf(input), "reverting all modules restores every original field")
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  })
})

function buildSource(input) {
  const q = input.singleQuote ? "'" : '"'
  const quoted = text => q + text + q
  const separator = input.multiline ? "\n  " : " "
  const semi = input.semicolons ? ";" : ""
  const declarations = Array.from({ length: input.plugins }, (_, i) =>
    "function p" + i + "() { return { name: " + quoted("p" + i) + " } }").join("\n")
  const calls = Array.from({ length: input.builds }, (_, i) =>
    "Bun.build({" + separator + "entrypoints: [" + quoted("src/main" + i + ".ts") + "]," +
    separator + "target: " + quoted("bun") + "," + separator + "minify: " + input.minify +
    (input.plugins ? "," + separator + "plugins: [" +
      Array.from({ length: input.plugins }, (_, n) => "p" + n + "()").join(", ") + "]" : "") +
    (input.multiline ? "\n" : " ") + "})" + semi).join("\n")
  return declarations + "\n" + calls + "\n"
}

test("migration wires every Bun.build once and preserves options and existing plugins (opencode-5)", async () => {
  const ts = loadTypeScript([join(repo, "packages/runtime")])
  await checkProperty(fc, {
    name: "migrate-bun-build", rule, regressions, numRuns: 80,
    command: "node --test test/migrate-priority.property.test.mjs",
    arbitrary: fc.record({
      builds: fc.integer({ min: 1, max: 5 }), plugins: fc.integer({ min: 0, max: 4 }),
      singleQuote: fc.boolean(), multiline: fc.boolean(), semicolons: fc.boolean(), minify: fc.boolean()
    }),
    artifacts: input => ({
      "script/build.ts": buildSource(input),
      "src/main0.ts": 'import { value } from "./leaf.vibe"\nconsole.log(value)\n',
      "src/leaf.vibe": "export const value = 42\n"
    }), diagnostics: () => diagnostics,
    check: input => {
      const source = buildSource(input)
      const wired = addBunBuildPlugin(source, ts)
      diagnostics = JSON.stringify({ input, source, wired })
      assert.equal(addBunBuildPlugin(wired, ts), wired, "setup reruns do not duplicate plugins")
      const parsed = ts.createSourceFile("build.ts", wired, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      assert.equal(parsed.parseDiagnostics.length, 0, diagnostics)
      const imports = parsed.statements.filter(node =>
        ts.isImportDeclaration(node) && node.moduleSpecifier.text === "vibelang-unplugin/bun")
      assert.equal(imports.length, 1, diagnostics)
      const executable = wired.slice(0, imports[0].getFullStart()) + wired.slice(imports[0].end)
      const builds = []
      runInNewContext("const vibelang = () => ({ name: 'vibelang' });\n" + executable, {
        Bun: { build: options => builds.push(JSON.parse(JSON.stringify(options))) }
      }, { timeout: 1000 })
      assert.deepEqual(builds, Array.from({ length: input.builds }, (_, i) => ({
        entrypoints: ["src/main" + i + ".ts"], target: "bun", minify: input.minify,
        plugins: [{ name: "vibelang" }, ...Array.from({ length: input.plugins }, (_, n) => ({ name: "p" + n }))]
      })), diagnostics)
    }
  })
})

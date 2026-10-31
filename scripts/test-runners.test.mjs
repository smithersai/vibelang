import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

// Every test file in the repository runs in a build-graph target, or is listed in `unrun` with what keeps it out.
// On 2026-10-31 eight suites ran nowhere: the migrate and convert flows' 174 tests, while 48 of the last 400
// commits changed the migrate flow; packages/compiler/test/eslint, which had been failing since `effect` functions
// landed; and create-vibelang's, which had one failure. A suite in no target rots without anyone seeing it.
const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")

// [test files, the file that runs them, the text in it that names them]
const runs = [
  ["scripts/*.test.mjs", "PACKAGE.ts", "scripts/*.test.mjs"],
  ["scripts/release/*.test.mjs", "PACKAGE.ts", "scripts/release/*.test.mjs"],
  ["typescript/vibelang/harness.test.mjs", "PACKAGE.ts", "typescript/vibelang/harness.test.mjs"],
  ["docs/redirect/*.test.mjs", "PACKAGE.ts", "docs/redirect/*.test.mjs"],
  [".smithers/flows/effect-bump/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/effect-bump/test/*.test.mjs"],
  ["docs/tools/*.test.*", "PACKAGE.ts", "cd docs/tools && bun test --timeout 60000 $(ls *.test.*"],
  ["packages/runtime/tests/**", "packages/PACKAGE.ts", "cd packages/runtime && bun test"],
  ["packages/compiler/test/*.test.mjs", "packages/PACKAGE.ts", "node --test test/*.test.mjs"],
  ["packages/compiler/test/tools/*.test.mjs", "packages/compiler/test/tools/run.sh", "./*.test.mjs"],
  [".smithers/flows/migrate/test/*.test.mjs", "packages/PACKAGE.ts", "migrate/test/*.test.mjs"],
  [".smithers/flows/convert/*.test.mjs", "packages/PACKAGE.ts", "convert/*.test.mjs"],
  [".smithers/flows/docs/check.test.ts", ".smithers/package.json", "./flows/docs/check.test.ts"],
  [".smithers/flows/effect-bump/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/effect-bump/test/*.test.mjs"],
  [".smithers/flows/ts-bump/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/ts-bump/test/*.test.mjs"],
  [".smithers/flows/ci-health/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/ci-health/test/*.test.mjs"],
  ["packages/vite/test/*.test.mjs", "packages/vite/test/run.sh", "test/*.test.mjs"],
  // A fixture project: coverage.test.mjs runs Vitest over it.
  ["packages/vite/test/coverage/test/*.test.ts", "packages/vite/test/coverage.test.mjs", "test/coverage"],
  // run.sh names each file on its node --test line; a file it leaves out runs nowhere.
  ...unpluginRunFiles().map((file) => [`packages/unplugin/${file}`, "packages/unplugin/test/run.sh", file]),
]

function unpluginRunFiles() {
  const line = read("packages/unplugin/test/run.sh").split("\n").find((l) => /^exec node --test /.test(l))
  assert.ok(line, "packages/unplugin/test/run.sh has no `exec node --test` line")
  return line.split(/\s+/).filter((word) => /^test\/[^/]+\.test\.mjs$/.test(word))
}

// [test files, why no target runs them]
const unrun = [
  ["typescript/tools/**", "upstream TypeScript's own tooling, outside VibeLang's packages"],
  ["typescript/packages/**", "upstream TypeScript's own packages, outside VibeLang's"],
  ["editors/vscode/**", "validate.sh's vscode step runs them, outside the build graph"],
  ["packages/ts-mapper/test/**", "validate.sh's go step runs them, outside the build graph"],
  ["packages/compiler/test/eslint/*.test.mjs", "run.sh installs their own lockfile; 2 of 27 fail on main: an effect function's name has no node"],
  ["packages/create-vibelang/test/*.test.mjs", "1 of 29 fails on main: the scaffold's main reports EK3205"],
  ["site/scripts/*.test.mjs", "they import the site's npm install; 32/32 pass with it"],
  ["editors/tree-sitter-vibelang/test/*.test.mjs", "the grammar property test fails on main"],
  ["scripts/bench/*.test.mjs", "they need the native compiler; the generator emits retired forms (maintainability backlog)"],
]

// A glob as the shell and `smthrs` read one: `**` crosses directories, `*` does not.
const matcher = (glob) =>
  new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*") + "$")

// The checkout's test files, without dependencies, fixtures, build output and other tools' directories. It walks
// the tree rather than asking jj: a graph mirror has no .jj.
const ignoredDirs = new Set(["node_modules", "fixtures", ".fixtures", "cases", "corpus", "testdata", "built", "dist", "out", ".cache"])
const ignoredTops = new Set(["examples", "templates", "prototype", "experiments"])
const testFiles = () => {
  const files = []
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        const hidden = entry.name.startsWith(".") && entry.name !== ".smithers"
        if (!hidden && !ignoredDirs.has(entry.name) && !(rel === "" && ignoredTops.has(entry.name))) walk(`${dir}/${entry.name}`, path)
      } else if (/\.test\.(mjs|js|ts|mts)$/.test(entry.name)) files.push(path)
    }
  }
  walk(fileURLToPath(root).replace(/\/$/, ""), "")
  return files
}

test("every test file runs in a target or says why not", () => {
  const all = [...runs.map(([glob]) => glob), ...unrun.map(([glob]) => glob)].map(matcher)
  assert.deepEqual(testFiles().filter((file) => !all.some((re) => re.test(file))), [])
})

test("each runner names the test files it is said to run", () => {
  assert.deepEqual(runs.filter(([, runner, text]) => !read(runner).includes(text)).map(([glob, runner]) => `${glob} in ${runner}`), [])
})

test("each entry matches a test file, so a moved suite leaves no stale line", () => {
  const files = testFiles()
  const stale = [...runs, ...unrun].map(([glob]) => glob).filter((glob) => !files.some((file) => matcher(glob).test(file)))
  assert.deepEqual(stale, [])
})

test("a glob crosses directories only with **", () => {
  assert.ok(matcher("scripts/*.test.mjs").test("scripts/a.test.mjs"))
  assert.ok(!matcher("scripts/*.test.mjs").test("scripts/release/a.test.mjs"))
  assert.ok(matcher("packages/runtime/tests/**").test("packages/runtime/tests/x/a.test.ts"))
})

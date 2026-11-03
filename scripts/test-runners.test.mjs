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
  ["site/scripts/not-found.test.mjs", "docs/tools/site-contrast.test.ts", "test:404"],
  ["site/scripts/patch-vocs-search.test.mjs", "site/package.json", "scripts/patch-vocs-search.test.mjs"],
  ["scripts/*.test.mjs", "PACKAGE.ts", "scripts/*.test.mjs"],
  ["scripts/bench/*.test.mjs", "scripts/bench/PACKAGE.ts", "node --test scripts/bench/gen-synthetic.test.mjs"],
  ["scripts/release/*.test.mjs", "PACKAGE.ts", "scripts/release/*.test.mjs"],
  ["typescript/native-deps.test.mjs", "typescript/PACKAGE.ts", "node --test typescript/native-deps.test.mjs"],
  ["typescript/native-inputs.test.mjs", "typescript/PACKAGE.ts", "node --test typescript/native-inputs.test.mjs"],
  ["typescript/vibelang/harness.test.mjs", "PACKAGE.ts", "typescript/vibelang/harness.test.mjs"],
  ["typescript/vibelang/coverage-twin.test.mjs", "typescript/vibelang/PACKAGE.ts", "node --test typescript/vibelang/coverage-twin.test.mjs"],
  ["typescript/vibelang/coverage-stock-twins.test.mjs", "PACKAGE.ts", "typescript/vibelang/coverage-stock-twins.test.mjs"],
  ["typescript/vibelang/vip7-reference.test.mjs", "PACKAGE.ts", "typescript/vibelang/vip7-reference.test.mjs"],
  ["docs/redirect/*.test.mjs", "PACKAGE.ts", "docs/redirect/*.test.mjs"],
  ["site/scripts/sync-spec-docs.test.mjs", "PACKAGE.ts", "site/scripts/sync-spec-docs.test.mjs"],
  ["site/scripts/sync-user-docs.test.mjs", "PACKAGE.ts", "site/scripts/sync-user-docs.test.mjs"],
  [".smithers/flows/effect-bump/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/effect-bump/test/*.test.mjs"],
  ["docs/tools/*.test.*", "PACKAGE.ts", "cd docs/tools && bun test --timeout 60000 --parallel=3 --no-isolate $(ls *.test.*"],
  ["packages/runtime/tests/**", "packages/PACKAGE.ts", "cd packages/runtime && bun test"],
  ["packages/compiler/test/*.test.mjs", "packages/PACKAGE.ts", "node --test test/*.test.mjs"],
  ["packages/compiler/test/tools/*.test.mjs", "packages/compiler/test/tools/run.sh", "./*.test.mjs"],
  [".smithers/flows/migrate/test/*.test.mjs", "packages/PACKAGE.ts", "migrate/test/*.test.mjs"],
  [".smithers/flows/convert/*.test.mjs", "packages/PACKAGE.ts", "convert/*.test.mjs"],
  [".smithers/flows/docs/check.test.ts", ".smithers/package.json", "./flows/docs/check.test.ts"],
  [".smithers/flows/effect-bump/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/effect-bump/test/*.test.mjs"],
  [".smithers/flows/ts-bump/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/ts-bump/test/*.test.mjs"],
  [".smithers/flows/ci-health/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/ci-health/test/*.test.mjs"],
  [".smithers/flows/first-bad/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/first-bad/test/*.test.mjs"],
  [".smithers/flows/test/*.test.mjs", "PACKAGE.ts", ".smithers/flows/test/*.test.mjs"],
  ["packages/vite/test/*.test.mjs", "packages/vite/test/run.sh", "test/*.test.mjs"],
  ["packages/create-vibelang/test/create.test.mjs", "PACKAGE.ts", "node --test packages/create-vibelang/test/create.test.mjs"],
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
  ["packages/compiler/test/eslint/*.test.mjs", "run.sh installs its own lockfile; remaining failures cover synthesized match reports, corpus parsing and declaration token ranges; the effect-modifier oracle runs in compiler-test"],
  ["packages/create-vibelang/test/e2e.test.mjs", "requires workspace compiler/runtime/Vite setup; scripts/e2e.sh covers the install/build/run path"],
  ["packages/create-vibelang/test/format.test.mjs", "requires VIBELANG_DPRINT and the built compiler formatting plugin"],
  ["packages/create-vibelang/test/create.property.test.mjs", "requires real packed compiler/runtime packages and package-manager installs for the scaffold build matrix"],
  ["packages/create-vibelang/test/yarn-classic.test.mjs", "requires the packed toolchain and Yarn Classic installation fixture"],
  ["site/scripts/patch-vocs-search.test.mjs", "requires the site's TypeScript and Vocs vendor files"],
  ["site/scripts/cloudflare-stack.test.mjs", "requires the site's TypeScript install"],
  ["site/scripts/deploy-load.test.mjs", "requires the site's Alchemy install"],
  ["site/scripts/llms.test.mjs", "requires built site publication output"],
  ["site/scripts/contrast.test.mjs", "requires the site's install, Chromium and a full site build"],
  ["editors/tree-sitter-vibelang/test/*.test.mjs", "the grammar property test fails on main"],
  [".smithers/flows/migrate/fixture/**", "the migrate eval's fixture package (@smthrs/canonical); eval.ts runs its tests before and after the flow"],
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

for (const [name, file] of [
  ["stock reference controls", "typescript/vibelang/coverage-stock-twins.test.mjs"],
  ["VIP-7 reference controls", "typescript/vibelang/vip7-reference.test.mjs"],
]) test(name + " have a release runner", () => {
  const entry = runs.find(([glob]) => matcher(glob).test(file))
  assert.ok(entry, file + " has no runner")
  const [, runner, command] = entry
  assert.equal(runner, "PACKAGE.ts")
  assert.ok(read(runner).includes(command), "the declared release command must select the controls")
})

test("the scaffold CLI unit suite has a fast native Node graph runner", () => {
  const file = "packages/create-vibelang/test/create.test.mjs"
  const entry = runs.find(([glob]) => matcher(glob).test(file))
  assert.ok(entry, file + " has no graph runner")
  const [, runner, command] = entry
  assert.equal(runner, "PACKAGE.ts")
  assert.equal(command, "node --test packages/create-vibelang/test/create.test.mjs")
  assert.ok(read(runner).includes(command), "the target must run the actual CLI unit suite")
  assert.ok(!unrun.some(([glob]) => matcher(glob).test(file)), "setup-dependent exceptions must not hide the fast CLI suite")
})

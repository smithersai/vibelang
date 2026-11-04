import assert from "node:assert/strict"
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRequire } from "node:module"
import { dirname, resolve, relative, join, basename } from "node:path"
import { tmpdir } from "node:os"
import { matchesGlob } from "node:path"
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
  ["site/scripts/patch-vocs-llms.test.mjs", "site/package.json", "scripts/patch-vocs-llms.test.mjs"],
  ["scripts/!(api-identity*).test.mjs", "PACKAGE.ts", "scripts/!(api-identity*).test.mjs"],
  ["scripts/api-identity*.test.mjs", "PACKAGE.ts", "node --test scripts/api-identity*.test.mjs"],
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

// Node expands the quoted release glob and the API target uses the same matcher.
const matcher = glob => ({ test: file => matchesGlob(file, glob) })

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

// Importing a flow test into a compiler entrypoint registers it in both targets.
const runtimeRequire = createRequire(new URL("packages/runtime/package.json", root))
const ts = runtimeRequire("typescript")
const fc = runtimeRequire("fast-check")
const corpus = JSON.parse(read("scripts/testdata/vibelang-duplicate-migration-entrypoints.json"))

function moduleReferences(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const references = new Set()
  const visit = node => {
    let module
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) module = node.moduleSpecifier
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) module = node.arguments[0]
    if (module && ts.isStringLiteralLike(module)) references.add(resolve(dirname(file), module.text))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return references
}

test("migration suites run in their own target without compiler reimports", () => {
  const repo = fileURLToPath(root)
  const flowTests = new Set(testFiles().filter(file =>
    matcher(".smithers/flows/migrate/test/*.test.mjs").test(file) ||
    matcher(".smithers/flows/convert/*.test.mjs").test(file)))
  assert.ok(flowTests.size > 0, "the standalone migration target has no suites")
  const duplicates = []
  for (const file of testFiles().filter(file => matcher("packages/compiler/test/*.test.mjs").test(file))) {
    for (const module of moduleReferences(resolve(repo, file), read(file))) {
      const target = relative(repo, module).split("\\").join("/")
      if (flowTests.has(target)) duplicates.push(file + " -> " + target)
    }
  }
  assert.deepEqual(duplicates, [], "flow suites already run in //packages:migrate-test; compiler imports repeat them")
})

test("entrypoint audit agrees with Node across import forms and ignores quoted examples", async () => {
  assert.equal(corpus.key, "compiler-test:migrate-suites-timeout")
  assert.ok(read("docs/maintainers/build.md").includes("Migration and convert suites run only"))
  await fc.assert(fc.asyncProperty(
    fc.constantFrom(...corpus.forms), fc.constantFrom(" ", "\n", " /* gap */ "),
    fc.boolean(), fc.boolean(),
    async (form, gap, dots, escaped) => {
      const dir = mkdtempSync(join(tmpdir(), "vibelang-suite-audit-"))
      const slot = Symbol.for("vibelang-suite-audit-modules")
      const previous = globalThis[slot]
      try {
        const entry = resolve(dir, corpus.entry)
        const target = resolve(dir, corpus.target)
        mkdirSync(dirname(entry), { recursive: true })
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, "globalThis[Symbol.for('vibelang-suite-audit-modules')].push(import.meta.url)\nexport const token=1\nexport default token\n")
        let specifier = relative(dirname(entry), target).split("\\").join("/")
        if (dots) specifier = dirname(specifier) + "/./" + basename(specifier)
        let literal = JSON.stringify(specifier)
        if (escaped) literal = literal.replace("onepass", "\\u006fnepass")
        const forms = {
          sideEffect: "import" + gap + literal,
          named: "import" + gap + "{token} from " + literal,
          namespace: "import" + gap + "* as suite from " + literal,
          exportStar: "export" + gap + "* from " + literal,
          exportNamed: "export" + gap + "{token} from " + literal,
          dynamic: "await" + gap + "import(" + literal + ")"
        }
        const source = "// import './not-loaded.test.mjs'\nconst example=\"import './not-loaded.test.mjs'\"\n" + forms[form] + "\n"
        writeFileSync(entry, source)
        globalThis[slot] = []
        await import(pathToFileURL(entry).href)
        const actual = [...new Set(globalThis[slot].map(url => fileURLToPath(url)))].sort()
        assert.deepEqual([...moduleReferences(entry, source)].sort(), actual)
        assert.deepEqual(actual, [target])
      } finally {
        if (previous === undefined) delete globalThis[slot]
        else globalThis[slot] = previous
        rmSync(dir, { recursive: true, force: true })
      }
    }
  ), { seed: 110025, numRuns: 48, examples: corpus.forms.map(form => [form, " ", false, false]) })
})

test("entrypoint audit agrees with Node for a multi-suite forwarder and repeated imports", async () => {
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), fc.boolean(), async (repeat, reverse, multiline) => {
    const dir = mkdtempSync(join(tmpdir(), "vibelang-multi-suite-audit-"))
    const slot = Symbol.for("vibelang-multi-suite-audit-modules")
    const previous = globalThis[slot]
    try {
      const entry = resolve(dir, corpus.multipleEntry)
      const targets = corpus.multipleTargets.map(target => resolve(dir, target))
      assert.equal(targets.length, 2)
      mkdirSync(dirname(entry), { recursive: true })
      for (const target of targets) {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, "globalThis[Symbol.for('vibelang-multi-suite-audit-modules')].push(import.meta.url)\n")
      }
      let imports = [...targets]
      if (repeat) imports.push(targets[0])
      if (reverse) imports.reverse()
      const source = imports.map(target => {
        let specifier = relative(dirname(entry), target).split("\\").join("/")
        if (!specifier.startsWith(".")) specifier = "./" + specifier
        return "import" + (multiline ? "\n" : " ") + JSON.stringify(specifier)
      }).join("\n") + "\n"
      writeFileSync(entry, source)
      globalThis[slot] = []
      await import(pathToFileURL(entry).href)
      const actual = globalThis[slot].map(url => fileURLToPath(url)).sort()
      assert.deepEqual(actual, [...targets].sort(), "each canonical suite registers once")
      assert.deepEqual([...moduleReferences(entry, source)].sort(), actual)
    } finally {
      if (previous === undefined) delete globalThis[slot]
      else globalThis[slot] = previous
      rmSync(dir, { recursive: true, force: true })
    }
  }), { seed: 110026, numRuns: 32 })
})

test("release and API globs give prefixed files one runner without dropping their neighbours", () => {
  const release = matcher("scripts/!(api-identity*).test.mjs")
  const api = matcher("scripts/api-identity*.test.mjs")
  for (const name of ["api-identity", "api-identity-extra", "api-identity space", "api-identityλ"]) {
    const file = "scripts/" + name + ".test.mjs"
    assert.equal(release.test(file), false)
    assert.equal(api.test(file), true)
  }
  for (const name of ["ordinary", "xapi-identity", "api_identity", "space name", "λ"]) {
    const file = "scripts/" + name + ".test.mjs"
    assert.equal(release.test(file), true)
    assert.equal(api.test(file), false)
  }
})

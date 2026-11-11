import assert from "node:assert/strict"
import { globSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("../", import.meta.url))
test("the migration compatibility label groups independent bounded tests", async () => {
  const run = spawnSync(process.execPath, [root + ".smithers/node_modules/.bin/smthrs",
    "graph", "//packages/...", "--workspace", root, "--format", "json"],
  { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024 })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const graph = JSON.parse(run.stdout)
  assert.equal(graph.targets.find(t => t.label === "//packages:migrate-test")?.target, "Suite")
  const { migrateDedicated, migrateShards } = await import("./testing/migrate-shards.mjs")
  const expected = [...migrateShards().map(s => s.label), ...Object.values(migrateDedicated)]
    .map(label => "//packages:" + label).sort()
  const members = graph.edges.filter(e => e.from === "//packages:migrate-test").map(e => e.to).sort()
  assert.deepEqual(members, expected, "the executable suite must include every owner exactly once")
  for (const label of expected) assert.ok(graph.edges.some(e =>
    e.from === label && e.to === "//:migration-sources"),
  label + " must retain the migration source dependency")
  const source = readFileSync(new URL("../packages/PACKAGE.ts", import.meta.url), "utf8")
  const body = source.slice(source.indexOf("const migrateTestTargets ="), source.indexOf("const migrateHelperIdentity ="))
  assert.match(body, /timeout:\s*"10m"/)
  assert.match(body, /data: \[\.\.\.migrateTestData/)
  assert.match(body, /shell: migrateShardShell\(shard\)/)
})

test("every migrate and convert file has exactly one compatibility-suite owner", async () => {
  const { migrateDedicated, migrateNamePartitions, migrateShards, migrateTestFiles } = await import("./testing/migrate-shards.mjs")
  const files = migrateTestFiles()
  const candidates = globSync([".smithers/flows/migrate/test/**/*.test.*", ".smithers/flows/convert/**/*.test.*"], { cwd: root })
    .map(file => file.replace(".smithers/flows/", "")).sort()
  assert.deepEqual(files, candidates, "a new test extension must join the shard inventory")
  const shards = migrateShards()
  assert.ok(files.length > 400)
  assert.deepEqual([...new Set([...shards.map(s => s.file), ...Object.keys(migrateDedicated)])].sort(), files)
  assert.equal(new Set(shards.map(s => s.label)).size, shards.length)
  for (const file of files) {
    const owners = shards.filter(s => s.file === file)
    const expected = Object.hasOwn(migrateDedicated, file) ? 0 : Object.hasOwn(migrateNamePartitions, file) ? 2 : 1
    assert.equal(owners.length, expected, file + " has the wrong number of owners")
    if (owners.length > 1) assert.ok(owners.every(s => s.namePattern), file + " repeats without a name partition")
  }
})

test("new files join automatically and duplicate or colliding entries fail", async () => {
  const { migrateShards, migrateTestFiles } = await import("./testing/migrate-shards.mjs")
  const files = migrateTestFiles()
  for (let i = 0; i < 64; i++) {
    const extra = "migrate/test/new-regression-" + i + ".test.mjs"
    assert.equal(migrateShards([...files, extra]).filter(s => s.file === extra).length, 1)
    assert.throws(() => migrateShards([extra, extra]), /duplicate/)
    assert.throws(() => migrateShards(["migrate/test/a.b.test.mjs", "migrate/test/a-b.test.mjs"]), /duplicate/)
  }
})

test("shard commands run exactly their file without external slice state or weakened flags", async () => {
  const { migrateShards, migrateShardShell } = await import("./testing/migrate-shards.mjs")
  for (const shard of migrateShards()) {
    const shell = migrateShardShell(shard)
    assert.ok(shell.endsWith("'" + shard.file + "'"), shard.label)
    assert.match(shell, /^cd \.smithers\/flows && node --test /)
    assert.match(shell, /--test-reporter=\.\.\/\.\.\/scripts\/testing\/migrate-progress\.mjs/)
    if (!shard.namePattern) assert.ok(!shell.includes("--test-name-pattern"))
    assert.doesNotMatch(shell, /--test-(?:skip-pattern|only|shard)|migrate-slice|(?:bun|npm) install/)
  }
})

test("name partitions cover actual Node execution and admit a new neighbouring test once", async t => {
  const { migrateNamePartitions, migrateComputedNames, migrateShards, migrateShardShell, flowRoot } = await import("./testing/migrate-shards.mjs")
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = mkdtempSync(join(tmpdir(), "migrate-name-inventory-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [file, generated] of Object.entries(migrateNamePartitions)) {
    const source = readFileSync(flowRoot + file, "utf8") + '\ntest("future neighbour [.*] 雪", () => {})\n'
    const parts = migrateShards([file], () => source)
    assert.equal(parts.length, 2)
    let names = [...source.matchAll(/^test\(("(?:[^"\\]|\\.)*")/gm)].map(m => JSON.parse(m[1]))
    assert.ok(names.includes(generated))
    const { createRequire } = await import("node:module")
    const ts = createRequire(new URL("../packages/runtime/package.json", import.meta.url))("typescript")
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const calls = [], functions = new Set(["test", "it", "describe", "suite"]), namespaces = new Set()
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "node:test") continue
      const clause = statement.importClause
      if (clause?.name) functions.add(clause.name.text)
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text)
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const item of clause.namedBindings.elements) {
          if (["test", "it", "describe", "suite"].includes(item.propertyName?.text ?? item.name.text)) functions.add(item.name.text)
        }
      }
    }
    const registration = expression => {
      if (ts.isIdentifier(expression)) return functions.has(expression.text)
      if (!ts.isPropertyAccessExpression(expression)) return false
      return (ts.isIdentifier(expression.expression) && namespaces.has(expression.expression.text) &&
        ["test", "it", "describe", "suite"].includes(expression.name.text)) ||
        (["only", "skip", "todo"].includes(expression.name.text) && registration(expression.expression))
    }
    const visit = node => {
      if (ts.isCallExpression(node) && registration(node.expression)) {
        assert.ok(ts.isStringLiteral(node.arguments[0]), "name-partitioned tests need a discovered literal name")
        calls.push(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    if (migrateComputedNames[file]) {
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
      const discovery = spawnSync(process.execPath,
        [fileURLToPath(new URL("./testing/node-test-names.mjs", import.meta.url)), flowRoot + file],
        { cwd: flowRoot, env, encoding: "utf8", timeout: 20_000 })
      assert.equal(discovery.status, 0, discovery.stdout + discovery.stderr)
      const line = discovery.stdout.split("\n").find(line => line.startsWith("NODE_TEST_NAMES "))
      names = [...JSON.parse(line.slice(16)), "future neighbour [.*] 雪"]
    } else {
      visit(ast)
      assert.deepEqual(names.sort(), calls.sort(), "the name inventory must include every registered test")
    }
    const fixture = join(dir, ".smithers/flows", file)
    mkdirSync(join(fixture, ".."), { recursive: true })
    mkdirSync(join(dir, "scripts/testing"), { recursive: true })
    writeFileSync(join(dir, "scripts/testing/migrate-progress.mjs"),
      readFileSync(new URL("./testing/migrate-progress.mjs", import.meta.url)))
    const trace = join(dir, "trace.jsonl")
    writeFileSync(fixture, 'import {test} from "node:test"; import {appendFileSync} from "node:fs";\n' +
      names.map(name => 'test(' + JSON.stringify(name) + ', () => appendFileSync(process.env.NAME_TRACE, ' +
        JSON.stringify(JSON.stringify(name) + "\n") + '))').join("\n"))
    const selected = []
    for (const part of parts) {
      rmSync(trace, { force: true })
      const env = { ...process.env, NAME_TRACE: trace }
      delete env.NODE_TEST_CONTEXT
      const run = spawnSync("sh", ["-c", migrateShardShell(part)],
        { cwd: dir, encoding: "utf8", timeout: 20_000, env })
      assert.equal(run.status, 0, run.stdout + run.stderr)
      assert.ok((await import("node:fs")).existsSync(trace), JSON.stringify({ pattern: part.namePattern, stdout: run.stdout, stderr: run.stderr }))
      const actual = readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse)
      assert.deepEqual(actual.sort(), names.filter(name => new RegExp(part.namePattern).test(name)).sort())
      selected.push(...actual)
    }
    assert.deepEqual(selected.sort(), names.sort(), "every test must run in exactly one real Node invocation")
  }
})

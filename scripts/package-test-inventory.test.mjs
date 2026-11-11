import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"
import { createRequire } from "node:module"
import { packageDeclarations } from "./testing/package-declarations.mjs"
import { testNamePattern, nodeTestSelection } from "./testing/node-selection.mjs"
import { spawnSync } from "node:child_process"
const require = createRequire(new URL("../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const root = new URL("../", import.meta.url)
const inventory = JSON.parse(readFileSync(new URL("packages/test-inventory.json", root), "utf8"))
const batches = JSON.parse(readFileSync(new URL("packages/test-batches.json", root), "utf8"))
const namedGroups = JSON.parse(readFileSync(new URL("packages/test-groups.json", root), "utf8"))
const directories = {
  compiler: "compiler/test", runtime: "runtime/tests", vite: "vite/test",
  unplugin: "unplugin/test", "compiler-tools": "compiler/test/tools",
  "source-map-tools": "compiler/test/source-maps", "typescript-shim": "typescript-shim/test"
}
function assertNamedBatch(selections, registrations = namedGroups) {
  const pattern = new RegExp(testNamePattern(selections.flatMap(atom => atom.names)))
  for (const file of new Set(selections.map(atom => atom.file))) {
    const actual = new Set(registrations[file].flat().filter(name => pattern.test(name)))
    const expected = new Set(selections.filter(atom => atom.file === file).flatMap(atom => atom.names))
    assert.deepEqual(actual, expected, "a shared pattern selects an unrequested registration: " + file)
  }
}
function checkInventory(groups, targets, batchPlan = batches) {
  const owned = new Set(), labels = new Set()
  for (const [group, dir] of Object.entries(directories)) {
    const walk = (dir) => readdirSync(new URL("packages/" + dir + "/", root), { withFileTypes: true })
      .flatMap(entry => entry.isDirectory() && !["node_modules", "dist", ".cache", ".fixtures"].includes(entry.name)
        ? walk(dir + "/" + entry.name)
        : entry.isFile() && /(?:[._](?:test|spec))\.(?:mjs|cjs|js|jsx|ts|tsx)$/.test(entry.name) ? [dir + "/" + entry.name] : [])
    const discovered = (group === "runtime" ? walk("runtime") :
      readdirSync(new URL("packages/" + dir + "/", root))
        .filter(file => /\.test\.mjs$/.test(file)).map(file => dir + "/" + file)).sort()
    // The inventory's order fixes each compiler file's compatibility partition (index % 4), so new files are
    // appended rather than sorted in; the set must still equal discovery exactly, with no file twice.
    assert.equal(new Set(groups[group]).size, groups[group].length, group + ": missing or repeated assertion file")
    assert.deepEqual([...groups[group]].sort(), discovered, group + ": missing or repeated assertion file")
  }
  targets ??= packageDeclarations(undefined, groups)
  for (const [group, dir] of Object.entries(directories)) {
    for (const file of groups[group]) {
      assert.ok(!owned.has(file), "repeated test file " + file)
      owned.add(file)
    }
    const atoms = groups[group].flatMap(file => {
      const base = group + "-test-" + file.split("/").pop().replace(/\.test\.[^.]+$/, "").replace(/\./g, "-")
      return (namedGroups[file] ?? [undefined]).map((names, part) => ({
        key: file + (names ? "#" + (part + 1) : ""), file, names,
        label: base + (names ? "-" + (part + 1) : "")
      }))
    })
    const byKey = new Map(atoms.map(atom => [atom.key, atom]))
    const batchKeys = batchPlan[group].flat()
    assert.equal(new Set(batchKeys).size, batchKeys.length, "a selection belongs to two batches")
    for (const batch of batchPlan[group]) {
      assert.ok(batch.length >= 2, "empty or singleton batch")
      for (const key of batch) assert.ok(byKey.has(key), "batch selection is outside its group")
      if (group === "compiler") assert.equal(new Set(batch.map(key => groups.compiler.indexOf(byKey.get(key).file) % 4)).size, 1, "batch crosses old compiler partitions")
    }
    const expected = atoms.filter(atom => !batchKeys.includes(atom.key)).map(atom => [atom.key]).concat(batchPlan[group])
    const suiteLeaves = group === "compiler" ? [1,2,3,4].flatMap(shard => {
      const suite = targets["compiler-test-" + shard]
      assert.equal(suite.kind, "Suite")
      return suite.tests.filter(t => t.kind === "Shell.Test")
    }) : targets[group + "-test"].tests.filter(t => t.kind === "Shell.Test")
    if (group !== "compiler") assert.equal(targets[group + "-test"].kind, "Suite")
    const expectedTargets = []
    for (const keys of expected) {
      const selections = keys.map(key => byKey.get(key))
      const files = [...new Set(selections.map(atom => atom.file))]
      assert.ok(selections.every(atom => Boolean(atom.names) === Boolean(selections[0].names)), "mixed full-file and named batch")
      const names = selections[0].names ? selections.flatMap(atom => atom.names) : undefined
      const label = selections[0].label + (keys.length > 1 ? "-group" : "")
      assert.ok(!labels.has(label), "colliding leaf label " + label)
      labels.add(label)
      const leaf = targets[label]
      assert.equal(leaf?.kind, "Shell.Test", "missing selection target " + label)
      expectedTargets.push(leaf)
      for (const file of files) {
        assert.ok(leaf.data.some(input => input.kind === "file" && input.path === file), label + ": assertion file is not an input")
        const token = group === "compiler" || group === "runtime" ? file.replace(/^[^/]+\//, "") :
          ["vite", "unplugin", "source-map-tools"].includes(group) ? file : "packages/" + file
        assert.equal(leaf.shell.split(/\s+/).filter(t => t === token).length, 1, label + ": command omits or repeats its file")
      }
      if (names) {
        assert.ok(leaf.shell.includes(nodeTestSelection(names)), label + ": named partition missing")
        assertNamedBatch(selections)
      }
      assert.doesNotMatch(leaf.shell, /--test-shard|\*\.test|bun install/, "leaves run provisioned selections")
      assert.match(leaf.timeout, /^(?:[1-9]|[1-9][0-9]|[1-3][0-9]{2}|4[0-7][0-9]|480)s$|^[1-8]m$/, "leaf exceeds eight-minute budget")
      const commandFiles = groups[group].filter(file => {
        const token = group === "compiler" || group === "runtime" ? file.replace(/^[^/]+\//, "") :
          ["vite", "unplugin", "source-map-tools"].includes(group) ? file : "packages/" + file
        return leaf.shell.split(/\s+/).includes(token)
      })
      assert.deepEqual(commandFiles.sort(), [...files].sort(), "command includes another leaf's assertion file")
    }
    assert.equal(suiteLeaves.length, expectedTargets.length, "compatibility Suite omits or repeats a leaf")
    assert.equal(new Set(suiteLeaves).size, suiteLeaves.length)
    assert.deepEqual(new Set(suiteLeaves), new Set(expectedTargets), "Suite selection differs from the inventory")
  }
  const declaredLeaves = Object.entries(targets).filter(([label,t]) =>
    t.kind === "Shell.Test" && Object.keys(directories).some(group => label.startsWith(group + "-test-")))
  assert.deepEqual(new Set(declaredLeaves.map(([label]) => label)), labels, "unowned executable leaf")

}
test("every package assertion file belongs to exactly one bounded leaf and compatibility Suite", () => checkInventory(inventory))
test("omitting, repeating or moving an assertion file cannot pass the inventory", () => {
  fc.assert(fc.property(fc.constantFrom(...Object.keys(directories)), fc.nat(), (group, index) => {
    const files = inventory[group], at = index % files.length
    for (const mode of ["omit", "repeat", "move"]) {
      const changed = structuredClone(inventory)
      if (mode === "omit") changed[group].splice(at, 1)
      if (mode === "repeat") changed[group].push(files[at])
      if (mode === "move") changed[group][at] = files[at] + ".missing"
      assert.throws(() => checkInventory(changed), /missing or repeated assertion file/)
    }
  }), { seed: 37181, numRuns: 70 })
})
test("batch mutations cannot omit or duplicate file ownership", () => {
  const targets = packageDeclarations()
  fc.assert(fc.property(fc.constantFrom(...Object.keys(batches)), fc.nat(), (group, index) => {
    const plan = structuredClone(batches), at = index % plan[group].length
    for (const mode of ["omit", "repeat", "cross"]) {
      const changed = structuredClone(plan)
      if (mode === "omit") changed[group].splice(at, 1)
      if (mode === "repeat") changed[group].push(changed[group][at])
      if (mode === "cross") changed[group][at].push("unknown/test.test.mjs")
      assert.throws(() => checkInventory(inventory, targets, changed))
    }
  }), { seed: 37183, numRuns: 35 })
})

test("the source-map Suite retains all adapter tests and compiler Suite one retains formatter tests", () => {
  const targets = packageDeclarations()
  assert.ok(targets["source-map-tools-test"].tests.includes(targets["compiler-tools-test"]))
  assert.ok(targets["compiler-test-1"].tests.some(t => t.kind === "formatter"))
})
test("a leaf cannot be replaced with a command that omits, duplicates or installs tests", () => {
  const targets = packageDeclarations()
  for (const suffix of ["", " test/*.test.mjs", " && bun install"]) {
    const changed = { ...targets, "compiler-test-cache-group": { ...targets["compiler-test-cache-group"], shell: suffix ? targets["compiler-test-cache-group"].shell + suffix : "node --test" } }
    assert.throws(() => checkInventory(inventory, changed))
  }
})


test("assertion readers retain README and sibling-file inputs in standalone groups", () => {
  const regrouped = structuredClone(batches)
  const dependencies = {
    "runtime/tests/readme-exports.test.ts": ["runtime/README.md"],
    "runtime/tests/package-budget.test.ts": ["runtime/tests/package.test.ts"],
    "compiler/test/launcher-cancellation.test.mjs": ["compiler/test/launcher.test.mjs"],
    "compiler/test/watch-intermediate.test.mjs": ["compiler/test/watch-warning.test.mjs"]
  }
  for (const file of Object.keys(dependencies)) {
    const group = file.startsWith("runtime/") ? "runtime" : "compiler"
    regrouped[group] = regrouped[group].map(batch => batch.filter(key => key !== file)).filter(batch => batch.length > 1)
  }
  const targets = packageDeclarations(undefined, inventory, regrouped)
  const verify = (values) => {
    for (const [file, inputs] of Object.entries(dependencies)) {
      const group = file.startsWith("runtime/") ? "runtime" : "compiler"
      const label = group + "-test-" + file.split("/").pop().replace(/\.test\.[^.]+$/, "").replace(/\./g, "-")
      const leaf = values[label]
      assert.ok(leaf, "standalone reader " + file)
      for (const input of inputs) assert.ok(leaf.data.some(item => item.kind === "file" && item.path === input), file + " must key " + input)
    }
  }
  verify(targets)
  for (const [file, inputs] of Object.entries(dependencies)) {
    const group = file.startsWith("runtime/") ? "runtime" : "compiler"
    const label = group + "-test-" + file.split("/").pop().replace(/\.test\.[^.]+$/, "").replace(/\./g, "-")
    for (const input of inputs) {
      const changed = { ...targets, [label]: { ...targets[label], data: targets[label].data.filter(item => item.path !== input) } }
      assert.throws(() => verify(changed), /must key/)
    }
  }
})

test("cross-file name filters reject collisions with an unrequested group", () => {
  fc.assert(fc.property(fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 6, maxLength: 9 }), names => {
    const [shared, a, b, c, d] = names
    const registrations = { a: [[shared, a], [b]], b: [[c], [shared, d]] }
    const selected = [{ file: "a", names: [shared, a] }, { file: "b", names: [c] }]
    assert.throws(() => assertNamedBatch(selected, registrations), /unrequested registration/)
    registrations.b[1] = [d]
    assertNamedBatch(selected, registrations)
  }), { seed: 37184, numRuns: 50 })
})

test("named partitions cover every registration once and reject unknown, repeated or missing names", () => {
  for (const [file, groups] of Object.entries(namedGroups)) {
    assert.ok(groups.length > 0 && groups.every(names => names.length > 0), "named selections must be nonempty")
    assert.ok(Object.values(inventory).flat().includes(file), "grouped file is not in the inventory")
    const ast = ts.createSourceFile(file, readFileSync(new URL("packages/" + file, root), "utf8"), ts.ScriptTarget.Latest, true)
    const nodeTestImports = ast.statements.filter(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === "node:test")
    assert.equal(nodeTestImports.length, 1, "grouped registrations need a direct node:test import")
    const bindings = nodeTestImports[0].importClause?.namedBindings
    assert.ok(bindings && ts.isNamedImports(bindings) && bindings.elements.length === 1 &&
      bindings.elements[0].name.text === "test" && !bindings.elements[0].propertyName,
      "grouped registration aliases need an explicit inventory reader")
    const names = [], visited = new Set()
    const evaluate = (node, scope) => {
      if (!node) return undefined
      if (ts.isStringLiteralLike(node)) return node.text
      if (ts.isNumericLiteral(node)) return Number(node.text)
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false
      if (ts.isConditionalExpression(node)) {
        const condition = evaluate(node.condition, scope)
        assert.notEqual(condition, undefined, "grouped conditional names need a static condition")
        return evaluate(condition ? node.whenTrue : node.whenFalse, scope)
      }
      if (ts.isIdentifier(node)) return scope[node.text]
      if (ts.isArrayLiteralExpression(node)) return node.elements.map(element => evaluate(element, scope))
      if (ts.isTemplateExpression(node)) {
        let value = node.head.text
        for (const span of node.templateSpans) {
          const part = evaluate(span.expression, scope)
          assert.notEqual(part, undefined, "grouped template names must have static loop bindings")
          value += String(part) + span.literal.text
        }
        return value
      }
      return undefined
    }
    const bind = (pattern, value, scope) => {
      if (ts.isIdentifier(pattern)) scope[pattern.text] = value
      else if (ts.isArrayBindingPattern(pattern)) pattern.elements.forEach((element, index) => {
        if (ts.isBindingElement(element)) bind(element.name, value?.[index], scope)
      })
      else assert.fail("unsupported grouped loop binding")
    }
    const visit = (node, scope = {}) => {
      if (ts.isForOfStatement(node)) {
        const values = evaluate(node.expression, scope)
        assert.ok(Array.isArray(values), "grouped registrations need a static loop inventory")
        for (const value of values) {
          const next = { ...scope }
          bind(node.initializer.declarations[0].name, value, next)
          visit(node.statement, next)
        }
        return
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "test") {
        const name = evaluate(node.arguments[0], scope)
        assert.equal(typeof name, "string", "grouped registrations need static names")
        names.push(name); visited.add(node.pos)
        return
      }
      if (ts.isFunctionLike(node)) return
      ts.forEachChild(node, child => visit(child, scope))
    }
    visit(ast)
    const audit = node => {
      if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && ["test", "it", "describe"].includes(node.expression.text)) ||
        (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && ["test", "it", "describe"].includes(node.expression.expression.text)))) {
        assert.ok(visited.has(node.pos), "a grouped registration is outside the checked static inventory")
      }
      ts.forEachChild(node, audit)
    }
    audit(ast)
    const expected = [...new Set(names)].sort()
    const check = candidate => {
      const actual = candidate.flat()
      assert.equal(new Set(actual).size, actual.length, "a name belongs to two groups")
      assert.deepEqual([...actual].sort(), expected, "named partition omits or invents tests")
    }
    check(groups)
    const missing = structuredClone(groups); missing[0].pop()
    assert.throws(() => check(missing))
    const repeated = structuredClone(groups); repeated[0].push(repeated[1][0])
    assert.throws(() => check(repeated))
    const unknown = structuredClone(groups); unknown[0][0] += " missing"
    assert.throws(() => check(unknown))
  }
})

test("name selectors preserve literal names through regular expressions and shell quoting", () => {
  fc.assert(fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 8 }), fc.string(), (names, candidate) => {
    assert.equal(new RegExp(testNamePattern(names)).test(candidate), names.includes(candidate))
    const result = spawnSync("sh", ["-c", "printf '%s' " + nodeTestSelection(names)], { encoding: "utf8" })
    assert.equal(result.status, 0)
    assert.equal(result.stdout, "--test-name-pattern=" + testNamePattern(names))
  }), { seed: 37182, numRuns: 60 })
})

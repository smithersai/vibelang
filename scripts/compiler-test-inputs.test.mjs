import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(new URL("../docs/tools/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

// //packages:runtime-dist deletes dist/ before it builds. A target that reads that directory without
// declaring the build shares the checkout with it: 9d38528780b3 changed packages/PACKAGE.ts, the build
// reran beside //packages:compiler-test, and the cache properties failed on a missing dist/index.js in
// 7 ms while every test in cache.test.mjs skipped. Declaring the build orders the two and puts dist/ in
// the test's cache key.

const repo = fileURLToPath(new URL("../", import.meta.url))
const read = (path) => readFileSync(repo + path, "utf8")

const unwrap = node => {
  while (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression
  return node
}
function compilerInputs(source) {
  const file = ts.createSourceFile("packages/PACKAGE.ts", source, ts.ScriptTarget.Latest, true)
  assert.equal(file.parseDiagnostics.length, 0, "package declaration must parse")
  let factory
  const targets = []
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "compilerTest") factory = node.initializer
    if (ts.isPropertyAssignment(node) && /^(?:compiler-test|compiler-test-[1-9]\d*)$/.test(node.name.text ?? "")) targets.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(factory, "packages/PACKAGE.ts has no compilerTest")
  factory = unwrap(factory)
  if (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory)) {
    factory = factory.body
    if (ts.isBlock(factory)) {
      const returns = factory.statements.filter(ts.isReturnStatement)
      assert.equal(returns.length, 1, "compilerTest must return one shell target")
      factory = returns[0].expression
    }
    factory = unwrap(factory)
  }
  assert.ok(ts.isCallExpression(factory) && factory.expression.getText(file).replace(/\s+/g, "") === "S.Shell.Test", "compilerTest must build a shell test")
  const object = unwrap(factory.arguments[0])
  assert.ok(ts.isObjectLiteralExpression(object), "compilerTest shell has no options")
  const data = object.properties.find(p => ts.isPropertyAssignment(p) && p.name.text === "data")
  assert.ok(data, "compilerTest declares no data")
  const entries = []
  const collect = node => {
    node = unwrap(node)
    assert.ok(ts.isArrayLiteralExpression(node), "compilerTest data must be an array")
    for (let element of node.elements) {
      if (ts.isSpreadElement(element)) {
        element = unwrap(element.expression)
        if (ts.isArrayLiteralExpression(element)) collect(element)
      } else {
        element = unwrap(element)
        if (ts.isIdentifier(element)) entries.push(element.text)
      }
    }
  }
  collect(data.initializer)
  return { file, entries, targets }
}
function assertRuntimePrerequisites(source, expectedShards = 4) {
  const { file, entries, targets } = compilerInputs(source)
  assert.ok(entries.includes("runtimeDist"), "compilerTest must declare runtimeDist unconditionally")
  assert.ok(targets.length > 0, "compiler-test has no registered targets")
  if (source.includes("const compilerSuite =")) {
    assert.deepEqual(targets.map(p => p.name.text).sort(), ["compiler-test-1", "compiler-test-2", "compiler-test-3", "compiler-test-4"])
    for (const property of targets) {
      const call = unwrap(property.initializer)
      assert.equal(call.expression.getText(file), "compilerSuite")
      assert.equal(Number(call.arguments[0].text), Number(property.name.text.slice("compiler-test-".length)))
    }
    assert.match(source, /testEntries\("compiler", inventory\.compiler, compilerTest\)/)
    assert.match(source, /build\(selectedFiles, names\)/)
    assert.match(source, /index % COMPILER_TEST_SHARDS === shard - 1/)
    return
  }
  const legacy = targets.filter(p => p.name.text === "compiler-test")
  if (legacy.length) {
    assert.equal(targets.length, 1, "compiler-test registrations cannot mix legacy and shard targets")
    assert.equal(legacy[0].initializer.getText(file), "compilerTest", "compiler-test must use the checked builder")
    return
  }
  assert.deepEqual(targets.map(p => Number(p.name.text.slice("compiler-test-".length))).sort((a,b) => a-b), Array.from({ length: expectedShards }, (_,i) => i+1), "compiler-test must register every shard once")
  for (const property of targets) {
    const call = unwrap(property.initializer)
    assert.ok(ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "compilerTest", "compiler-test shard must use the checked builder")
    assert.equal(call.arguments.length, 1, "compiler-test shard takes its index")
    assert.ok(ts.isNumericLiteral(call.arguments[0]), "compiler-test shard index must be numeric")
    assert.equal(Number(call.arguments[0].text), Number(property.name.text.slice("compiler-test-".length)), "compiler-test shard index must match its target")
  }
}

const readersOfRuntimeDist = () =>
  readdirSync(repo + "packages/compiler/test")
    .filter((file) => file.endsWith(".mjs"))
    .filter((file) => /runtime[/"', ]+dist/.test(read(`packages/compiler/test/${file}`)))

test("the compiler package's tests read the runtime's dist/", () => {
  assert.ok(readersOfRuntimeDist().length >= 2, "no compiler test reads packages/runtime/dist: retire this check")
})

test("every compiler-test shard declares the runtime build its tests read", () => {
  assertRuntimePrerequisites(read("packages/PACKAGE.ts"))
})

function declaration(kind, element, count, quote) {
  const options = "S.Shell.Test({ data: [compilerNative, " + element + ", S.glob('compiler/**')] })"
  const initializer = kind === "value" ? options : kind === "factory" ? "(shard: number) => " + options : "(shard: number) => { return " + options + "; }"
  const targets = kind === "value" ? quote + "compiler-test" + quote + ": compilerTest" :
    Array.from({ length: count }, (_,i) => quote + "compiler-test-" + (i+1) + quote + ": compilerTest(" + (i+1) + ")").join(", ")
  return "const compilerTest = " + initializer + ";\nconst targets = { " + targets + " };\n"
}

test("factory syntax and casts retain the prerequisite while shard mutations fail", () => {
  fc.assert(fc.property(
    fc.constantFrom("value", "factory", "block"),
    fc.constantFrom("runtimeDist", "(runtimeDist)", "runtimeDist as never", "...[runtimeDist]"),
    fc.integer({ min: 1, max: 6 }),
    fc.constantFrom('"', "'"),
    (kind, element, count, quote) => {
      const good = declaration(kind, element, count, quote)
      assertRuntimePrerequisites(good, count)
      for (const missing of ["compilerNative", "/* runtimeDist */ compilerNative", '"runtimeDist"', "...(shard === 1 ? [runtimeDist] : [])"]) {
        assert.throws(() => assertRuntimePrerequisites(declaration(kind, missing, count, quote), count), /runtimeDist/)
      }
      const wrongBuilder = good.replace(/: compilerTest(?=\(|[,} ])/, ": uncheckedBuilder")
      assert.throws(() => assertRuntimePrerequisites(wrongBuilder, count), /compiler-test/)
      if (kind !== "value") {
        assert.throws(() => assertRuntimePrerequisites(good.replace("compilerTest(1)", "compilerTest(2)"), count), /index/)
        assert.throws(() => assertRuntimePrerequisites(good, count+1), /every shard/)
      }
    }
  ), { seed: 181004, numRuns: 120 })
})

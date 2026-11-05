import assert from "node:assert/strict"
import { existsSync, readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { runPhaseChanges, vibeTree } from "../lib/run-phase.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-curried-factory-run-phase.json", import.meta.url)))
const changes = (before, after) => {
  assert.ok(existsSync(compiler), "build the native compiler before checking returned callables")
  assert.deepEqual(ts.createSourceFile("main.ts", before, ts.ScriptTarget.Latest, true).parseDiagnostics, [])
  return runPhaseChanges({ ts, original: before, originalPath: "main.ts",
    vibe: vibeTree(compiler, after, "main.vibe"), vibeText: after })
    .map(({ name, verdict }) => ({ name, verdict }))
}

test("returned callable identity quotes the function-kind contract", () => {
  const chapter = readFileSync(SpecPath(corpus.chapter), "utf8")
  assert.ok(chapter.includes(corpus.quote))
  assert.ok(chapter.includes(corpus.equivalenceQuote))
  assert.ok(chapter.includes("each export's type identical to `tsc`'s in both directions"))
  assert.ok(readFileSync(SpecPath("003-failures.md"), "utf8").includes(corpus.catchQuote))
})
for (const sample of corpus.samples) test("t3code returned callable: " + sample.key, () => {
  const result = changes(sample.before, sample.after)
  assert.deepEqual(sample.blockingOnly ? result.filter(c => c.verdict === "value" || c.verdict === "eager") : result, sample.expected)
})

test("separate return sites retain their ordinal and later value changes", () => {
  assert.deepEqual(changes(
    'import { Effect } from "effect"; export function make(flag) { if (flag) return () => Effect.gen(function* () {}); return () => 42; }',
    'export function make(flag) { if (flag) return effect () => {}; return effect () => 42; }'),
  [{ name: "make/return#1", verdict: "value" }])
})

test("returned callables preserve enclosing timing checks", () => {
  assert.deepEqual(changes(
    'import { Effect } from "effect"; export function make() { read(); return () => Effect.gen(function* () {}); }',
    'export effect function make() { read(); return effect () => {}; }'),
  [{ name: "make", verdict: "value" }])
})

// The keyword decides each individual function's kind. Returning a callable
// creates a distinct slot at every depth; plain value-to-program changes
// must still be attributed to the function whose keyword changed.
test("property: curried functions keep independent call phases", async () => {
  await checkProperty(fc, {
    name: corpus.key, rule: corpus.quote,
    command: "node --test .smithers/flows/migrate/test/curried-factory-run-phase.property.test.mjs",
    arbitrary: fc.record({
      depth: fc.integer({ min: 1, max: 4 }), style: fc.constantFrom("arrow", "function"),
      cast: fc.boolean(), mutation: fc.constantFrom("none", "outer", "leaf-value", "leaf-drop"),
    }), numRuns: 80,
    check: ({ depth, style, cast, mutation }) => {
      const wrap = (body, effect = false) => {
        const value = style === "function"
          ? (effect ? "effect " : "") + "function () { return " + body + "; }"
          : (effect ? "effect " : "") + "() => " + body
        return cast ? "((" + value + ") as any)" : "(" + value + ")"
      }
      let before = mutation === "leaf-value" ? wrap("42") : wrap('Effect.gen(function* () { return 42; })')
      let after = "effect () => { " + (mutation === "leaf-drop" ? "" : "return 42;") + " }"
      for (let i = depth - 1; i >= 0; i--) {
        before = wrap(before)
        after = wrap(after, mutation === "outer" && i === 0)
      }
      before = 'import { Effect } from "effect"; export const make = ' + before + ";"
      after = "export const make = " + after + ";"
      const expected = mutation === "outer" ? [{ name: "make", verdict: "value" }]
        : mutation === "leaf-value" || mutation === "leaf-drop"
          ? [{ name: "make" + "/return".repeat(depth), verdict: "value" }] : []
      assert.deepEqual(changes(before, after), expected)
    },
  })
})

test("property: catch handlers retain their own value and timing checks", async () => {
 await checkProperty(fc, {
  name: corpus.key + "-catch", rule: corpus.catchQuote,
  command: "node --test .smithers/flows/migrate/test/curried-factory-run-phase.property.test.mjs",
  arbitrary: fc.record({ count: fc.integer({min:1,max:4}), curried: fc.boolean(), alias: fc.boolean(), drop: fc.boolean(), eager: fc.boolean() }),
  numRuns: 40,
  check: ({count,curried,alias,drop,eager}) => {
   const before = Array.from({length:count},(_,i) => {
    const handler = "() => { " + (eager && i===count-1 ? "read(); " : "") + "return Effect.gen(function* () { return 42; }); }"
    return "const item" + i + " = " + (curried ? "source.pipe(Effect.catch(" + handler + "))" : "Effect.catch(source, " + handler + ")") + ";"
   }).join(" ")
   const after = Array.from({length:count},(_,i) => "const item" + i + " = source catch effect () => { " + (drop && i===count-1 ? "" : "return 42;") + " };").join(" ")
   const original = 'import { Effect } from "effect"; export const make = () => { ' + before + ' return Effect.gen(function* () {}); };'
   const result = changes(alias ? original.replaceAll("Effect.", "FX.").replace("{ Effect }", "{ Effect as FX }") : original,
    "export const make = () => effect { " + after + " };")
   const verdict = eager ? "eager" : drop ? "value" : null
   assert.deepEqual(result, verdict ? [{name:"make.item"+(count-1)+"/catch(0)",verdict}] : [])
  },
 })
})

test("stock TypeScript retains the curried program API", () => {
 const root = mkdtempSync(join(tmpdir(), "curried-program-api-"))
 try {
  const source = join(root, "factory.ts")
  writeFileSync(source, corpus.samples.find(s => s.key === "curried-die").before +
   "\ntype Expected = (kind: string) => () => Effect.Effect<never, never, never>;" +
   "\nconst forward: Expected = make; const reverse: typeof make = null as unknown as Expected;")
  symlinkSync(dirname(require.resolve("effect/package.json")) + "/..", join(root, "node_modules"), "dir")
  const program = ts.createProgram([source], { strict: true, noEmit: true, skipLibCheck: true,
   target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
  const declaration = program.getSourceFile(source).statements.find(ts.isVariableStatement).declarationList.declarations[0]
  const checker = program.getTypeChecker()
  const signature = checker.typeToString(checker.getTypeAtLocation(declaration.name), declaration, ts.TypeFormatFlags.NoTruncation)
  console.log(JSON.stringify({ stockTypeScript: ts.version, diagnostics: 0, signature }))
 } finally { rmSync(root, {recursive:true,force:true}) }
})

test("property: nested catch calls preserve the native handler order", async () => {
 await checkProperty(fc, {
  name: corpus.key + "-nested-catch", rule: corpus.catchQuote,
  command: "node --test .smithers/flows/migrate/test/curried-factory-run-phase.property.test.mjs",
  arbitrary: fc.record({ depth: fc.integer({min:1,max:4}), selected: fc.integer({min:0,max:3}),
   styles: fc.integer({min:0,max:80}), drop: fc.boolean() }), numRuns: 40,
  check: ({depth,selected,styles,drop}) => {
   const changed = selected % depth
   let before = "source", after = "source"
   for (let i=0;i<depth;i++) {
    const handler = "() => Effect.gen(function* () { " + (i===changed ? "return 42;" : "") + " })"
    const style = Math.floor(styles / 3**i) % 3
    before = style===0 ? "Effect.catch(" + before + ", " + handler + ")"
     : style===1 ? "Effect.catch(" + handler + ")(" + before + ")"
      : "(" + before + ").pipe(Effect.catch(" + handler + "))"
    after = "(" + after + " catch effect () => { " + (i===changed && !drop ? "return 42;" : "") + " })"
   }
   assert.deepEqual(changes('import { Effect } from "effect"; export const recover = () => ' + before + ";",
    "export const recover = () => effect { return " + after + "; };"),
    drop ? [{name:"recover/catch(0)" + (changed ? "#" + changed : ""),verdict:"value"}] : [])
  },
 })
})

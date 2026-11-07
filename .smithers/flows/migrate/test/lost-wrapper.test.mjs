// The lost-wrapper check: a converted function that hands back fewer Effect
// values than its original, which types, declarations and the wrapper-gain
// audit all pass. The shapes are Smithers' (agent/plugin Plugins,
// platform-cloudflare Refusals, sandbox TestSession).
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { emittedPathOf, functionsOf, lostWrapperCheck, lostWrappers, readAllowList } from "../lib/lost-wrapper.mjs"
import { checkLostWrappers, emitMigratedJs, makeConfig, paths, verify } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, readJson, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const scan = (original, emitted) => lostWrappers({ ts, original, emitted })
const flagged = (original, emitted) => scan(original, emitted).flags.map(f => `${f.function} ${f.effectReturns}->${f.emittedEffectReturns}`)

const header = `import { Effect } from "effect"\n`
const jsHeader = `import * as Effect from "effect/Effect";\n`

test("Plugins: a bare array behind an as cast is flagged, and marked as behind the cast", () => {
  const original = header + `type Service = { readonly parallel: (kind: string, n: number) => Effect.Effect<ReadonlyArray<string>> }
export const parallel = ((kind: string, n: number) => {
  const mismatch = kind === "isolated" ? "declared sequential" : undefined
  if (mismatch !== undefined) return Effect.succeed([mismatch])
  return Effect.succeed([\`ran \${n}\`])
}) as Service["parallel"]
export const fine = (n: number) => Effect.succeed(n)
`
  const emitted = jsHeader + `export const parallel = ((kind, n) => {
    const mismatch = kind === "isolated" ? "declared sequential" : undefined;
    if (mismatch !== undefined) return [mismatch];
    return Effect.succeed([\`ran \${n}\`]);
});
export const fine = Effect.fnUntraced(function* (n) { return n; });
`
  const { flags } = scan(original, emitted)
  assert.deepEqual(flags.map(f => [f.function, f.effectReturns, f.emittedEffectReturns, f.cast]), [["/parallel", 2, 1, true]])
})

test("a cast around the return, not the function, marks the flag too", () => {
  const { flags } = scan(header + `export const f = (xs: string[]) => { return Effect.succeed(xs) as unknown as Effect.Effect<string[]> }\n`, `export const f = (xs) => { return xs; };\n`)
  assert.deepEqual(flags.map(f => [f.function, f.cast]), [["/f", true]])
})

test("Refusals: a plain arrow that throws where the .ts returned Effect.fail is flagged once, at the arrow", () => {
  assert.deepEqual(flagged(
    header + `const refuse = (method: string) => () => Effect.fail(new Error(method))\n`,
    `const refuse = (method) => () => (() => { throw new Error(method); })();\n`), ["/refuse/anon 1->0"])
})

test("a throw beside an Effect return still counts as the lost Effect.fail", () => {
  assert.deepEqual(flagged(
    header + `export function f(bad: boolean) { if (bad) return Effect.fail("no"); return Effect.succeed(1) }\n`,
    jsHeader + `export function f(bad) { if (bad) throw "no"; return Effect.succeed(1); }\n`), ["/f 2->1"])
})

test("TestSession: one arm of a conditional losing its wrapper is flagged", () => {
  assert.deepEqual(flagged(
    header + `export const acquire = (failure: string | undefined) => failure === undefined ? Effect.succeed(1) : Effect.fail(failure)\n`,
    jsHeader + `export const acquire = (failure) => failure === undefined ? Effect.succeed(1) : (() => { throw failure; })();\n`), ["/acquire 2->1"])
})

test("a function the compiler emits as a generator is never flagged", () => {
  const original = header + `export const a = (n: number) => { if (n > 0) return Effect.succeed(n); return Effect.fail("no") }
export const b = (n: number) => Effect.gen(function* () { return n })
export const c = Effect.fn("c")((n: number) => Effect.gen(function* () { return n }))
export const d = Effect.fn("d")(function* (n: number) { return n })
export const e = (n: number) => Effect.succeed(n)
export const n = { run: (x: number) => Effect.succeed(x) }
export class K { m() { return Effect.succeed(1) } }
`
  const emitted = `import * as Effect_1 from "effect/Effect";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime";
export const a = Effect_1.fnUntraced(function* (n) { if (n > 0) return n; throw "no"; });
export const b = Effect_1.fnUntraced(function* (n) { return n; });
export const c = Effect.fn("c")(Effect_1.fnUntraced(function* (n) { return n; }));
export const d = Effect.fn("d")(function* (n) { return n; });
export const e = Effect_1.fnUntraced(runtime.$joinedFrame(function* e(n) { return n; }));
export const n = { run: Effect_1.fnUntraced({ *run(x) { return x; } }.run) };
export class K { *m() { return 1; } }
`
  const result = scan(original, emitted)
  assert.deepEqual(result.flags, [])
  assert.deepEqual(result.unpaired, [])
})

test("an Effect.gen body handed back by a plain function keeps the program on every path", () => {
  assert.deepEqual(flagged(
    header + `export const f = (n: number) => { if (n) return Effect.succeed(1); return Effect.fail(2) }\n`,
    jsHeader + `export const f = (n) => { return Effect.gen(function* () { if (n) return 1; return yield* Effect.fail(2); }); };\n`), [])
})

test("an Effect.fn that became a plain function is flagged", () => {
  assert.deepEqual(flagged(header + `export const f = Effect.fn("f")(function* (n: number) { return n })\n`, `export const f = (n) => n;\n`), ["/f 1->0"])
})

test("callbacks pair by callee and argument index: a call the compiler inserts shifts nothing", () => {
  const original = header + `declare const first: any, second: any
first(() => Effect.succeed(1))
second(() => 2)
`
  const emitted = jsHeader + `$inserted(() => 0);
first(() => Effect.succeed(1));
second(() => 2);
`
  assert.deepEqual(flagged(original, emitted), [])
  // By position `first`'s callback read as `$inserted`'s, a false flag.
  assert.deepEqual([...functionsOf(ts, original).keys()], ["/first(0)", "/second(0)"])
})

test("callbacks pair by callee and argument index: a moved call does not hide a loss", () => {
  // By position `second`'s callback read as `first`'s, which kept its wrapper: no flag.
  assert.deepEqual(flagged(
    header + `declare const first: any, second: any
first(() => 1)
second(() => Effect.succeed(2))
`,
    jsHeader + `second(() => 2);
first(() => Effect.succeed(1));
`), ["/second(0) 1->0"])
})

test("callbacks pair by callee and argument index: the flag names the argument that lost it", () => {
  const original = header + `export const f = Effect.match(x, { }, () => Effect.succeed(1), () => Effect.succeed(2))\n`
  const emitted = jsHeader + `export const f = Effect.match(x, { }, () => Effect.succeed(1), () => 2);\n`
  assert.deepEqual(flagged(original, emitted), ["/f/Effect.match(3) 1->0"])
})

test("two callbacks of one callee and index in one function still pair in their order", () => {
  assert.deepEqual(flagged(
    header + `declare const on: any\nexport const f = () => { on(() => Effect.succeed(1)); on(() => Effect.succeed(2)) }\n`,
    jsHeader + `export const f = () => { on(() => Effect.succeed(1)); on(() => 2); };\n`), ["/f/on(0)#1 1->0"])
})

test("Effect aliases count on both sides, and a type naming Effect is no Effect", () => {
  assert.deepEqual(flagged(`import { Effect as E } from "effect"\nexport const f = (x: number) => E.succeed(x)\n`, `export const f = (x) => x;\n`), ["/f 1->0"])
  assert.deepEqual(flagged(`import * as X from "effect/Effect"\nexport const f = (x: number) => X.succeed(x)\n`, `export const f = (x) => x;\n`), ["/f 1->0"])
  assert.deepEqual(flagged(`import { succeed } from "effect/Effect"\nexport const f = (x: number) => succeed(x)\n`, `export const f = (x) => x;\n`), ["/f 1->0"])
  assert.deepEqual(flagged(header + `declare const load: () => unknown\nexport const f = () => load() as Effect.Effect<number>\n`, `export const f = () => load();\n`), [])
})

test("names hold in classes and objects: one method losing its wrapper is not another's", () => {
  assert.deepEqual(flagged(
    header + `export class A { m() { return Effect.succeed(1) } }\nexport class B { m() { return Effect.succeed(2) } }\nexport const o = { m: () => Effect.succeed(3) }\n`,
    jsHeader + `export class A { m() { return Effect.succeed(1); } }\nexport class B { m() { return 2; } }\nexport const o = { m: () => Effect.succeed(3) };\n`), ["/B/m 1->0"])
})

test("an Effect-returning function with no emitted counterpart is listed, not flagged", () => {
  const { flags, unpaired } = scan(header + `export const renamed = () => Effect.succeed(1)\n`, jsHeader + `export const other = () => Effect.succeed(1);\n`)
  assert.deepEqual(flags, [])
  assert.deepEqual(unpaired.map(u => u.function), ["/renamed"])
})

const check = (allow) => lostWrapperCheck({
  ts, files: ["src/a.vibe", "src/a.test.vibe", "test/helper.vibe", "src/gone.vibe", "src/noemit.vibe", "README.md"],
  original: file => file === "src/gone.vibe" ? null : { path: file.replace(/\.vibe$/, ".ts"), text: header + `export const f = () => Effect.succeed(1)\nexport const g = () => Effect.succeed(2)\n` },
  emitted: file => file === "src/a.vibe" ? { path: "a.js", text: `export const f = () => 1;\nexport const g = () => 2;\n` } : null,
  allow
})

test("the check: a flag blocks, a test module is skipped, and an unreadable module is unchecked", () => {
  const result = check()
  assert.deepEqual(result.blocking.map(f => [f.file, f.function]), [["src/a.vibe", "/f"], ["src/a.vibe", "/g"]])
  assert.deepEqual(result.unchecked.map(u => u.file), ["src/gone.vibe", "src/noemit.vibe"])
  assert.equal(result.modules, 1)
})

test("the allow-list: an entry with a reason lifts that function only, and a stale entry is reported", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-lost-wrapper-"))
  try {
    const file = join(root, "allow.json")
    writeFileSync(file, JSON.stringify([
      { file: "src/a.vibe", function: "/f", reason: "the caller wraps it" },
      { file: "src/a.vibe", function: "/g", reason: "  " },
      { file: "src/a.vibe", function: "/stale", reason: "was renamed" }
    ]))
    const result = check(readAllowList(file))
    assert.deepEqual(result.blocking.map(f => f.function), ["/g"])
    assert.deepEqual(result.allowed.map(f => [f.function, f.reason]), [["/f", "the caller wraps it"]])
    assert.deepEqual(result.invalidAllow.map(e => e.function), ["/g"])
    assert.deepEqual(result.unusedAllow.map(e => e.function), ["/stale"])
    writeFileSync(file, "{}")
    assert.throws(() => readAllowList(file), /JSON array/)
    assert.deepEqual(readAllowList(join(root, "missing.json")), { entries: [], invalid: [] })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the allow-list: `function: \"*\"` excuses a module the check cannot read, with a reason, and lifts no flag", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-lost-wrapper-"))
  try {
    const file = join(root, "allow.json")
    writeFileSync(file, JSON.stringify([
      { file: "src/noemit.vibe", function: "*", reason: "an example no project compiles" },
      { file: "src/gone.vibe", function: "*", reason: "" },
      { file: "src/a.vibe", function: "*", reason: "does not lift a flag" }
    ]))
    const result = check(readAllowList(file))
    assert.deepEqual(result.excused.map(e => [e.file, e.allowedBecause]), [["src/noemit.vibe", "an example no project compiles"]])
    assert.deepEqual(result.unchecked.map(u => u.file), ["src/gone.vibe"])
    assert.deepEqual(result.blocking.map(f => f.function), ["/f", "/g"])
    assert.deepEqual(result.unusedAllow.map(e => e.file), ["src/a.vibe"])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a module's emitted JavaScript is under the nearest package's .vibelang/js", () => {
  const packages = [".", "packages/a", "packages/a/nested"]
  assert.equal(emittedPathOf("packages/a/src/x.vibe", packages).path, "packages/a/.vibelang/js/src/x.js")
  assert.equal(emittedPathOf("packages/a/nested/x.vibex", packages).path, "packages/a/nested/.vibelang/js/x.jsx")
  assert.equal(emittedPathOf("top.vibe", packages).path, ".vibelang/js/top.js")
  assert.equal(emittedPathOf("top.vibe", ["packages/a"]), null)
})

// A stand-in compiler: type-checks clean, and for an emit writes each .vibe's given JavaScript at --outDir.
function fixture(root, { before, emitted, exportsJs }) {
  const target = join(root, "repo"), run = join(root, "run")
  mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
  writeJson(join(target, "package.json"), { name: "lost-wrapper-fixture", private: true, type: "module", ...(exportsJs ? { exports: { ".": { default: "./.vibelang/js/main.js" } } } : {}) })
  writeJson(join(target, "tsconfig.json"), { include: ["*.vibe"] })
  writeFileSync(join(target, "main.vibe"), "export const f = 1\n")
  writeFileSync(join(target, "emitted.txt"), emitted)
  const bin = join(target, "node_modules/.bin/vibelang")
  writeFileSync(bin, `#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = "--outDir" ] && out="$2"; [ "$1" = "--estree" ] && exit 1; shift; done
if [ -n "$out" ] && [ "\${out#*dts}" = "$out" ]; then
  mkdir -p "$out"
  cp "$PWD/emitted.txt" "$out/main.js"
  printf '{"version":3,"sources":["%s/main.vibe"],"names":[],"mappings":""}' "$PWD" > "$out/main.js.map"
  echo "TSFILE: $out/main.js.map"
  echo "TSFILE: $out/main.js"
fi
exit 0
`)
  chmodSync(bin, 0o755)
  writeFileSync(join(target, ".gitignore"), "node_modules/\n")
  const p = paths(run)
  writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
  writeJson(p.plan, { batches: [{ files: ["main.ts"] }] })
  writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
  writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
  writeJson(p.codemodState("01"), { version: 1, phase: "fixing", files: ["main.ts"], renames: [{ from: "main.ts", to: "main.vibe" }], originals: [{ from: "main.ts", to: "main.vibe", bytes: Buffer.from(before).toString("base64") }] })
  return { target, run, p }
}
const inFixture = async (options, body) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-lost-wrapper-"))
  try {
    const made = fixture(root, options)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: made.target })
    await Jj.commit(made.target, "migrated input")
    await body(made)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const before = header + `export const f = () => Effect.succeed(1)\n`

test("verify fails a batch on a lost wrapper in the flow's own emit, until the run's allow-list names it with a reason", async () => {
  await inFixture({ before, emitted: `export const f = () => 1;\n`, exportsJs: true }, async ({ run, p }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.lostWrappers, false, JSON.stringify(result.lostWrappers))
    assert.equal(result.ok, false)
    assert.deepEqual(result.lostWrappers.blocking.map(f => [f.file, f.function]), [["main.vibe", "/f"]])
    writeJson(p.lostWrapperAllow, [{ file: "main.vibe", function: "/f", reason: "fixture" }])
    const allowed = await verify({ run, batch: "01" })
    assert.equal(allowed.checks.lostWrappers, true, JSON.stringify(allowed.lostWrappers))
    assert.deepEqual(allowed.lostWrappers.allowed.map(f => f.reason), ["fixture"])
  })
})

test("verify passes a batch whose emit keeps the wrapper", async () => {
  await inFixture({ before, emitted: jsHeader + `export const f = Effect.fnUntraced(function* () { return 1; });\n`, exportsJs: true }, async ({ run }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.lostWrappers, true, JSON.stringify(result.lostWrappers))
    assert.equal(result.lostWrappers.modules, 1)
  })
})

test("a project skipped by normal emission uses scratch and keeps the lost-wrapper gate", async () => {
  await inFixture({ before, emitted: `export const f = () => 1;\n`, exportsJs: false }, async ({ run, target, p }) => {
    // Verify also requires manifests for build and declaration checks. Exercise
    // its fallback directly with the real emitter's skipped-project result.
    const config = readJson(p.config), plan = readJson(p.plan)
    const logs = join(p.batch("01"), "logs")
    rmSync(join(target, "package.json"))
    const emittedJs = await emitMigratedJs(config, target, logs)
    assert.equal(emittedJs.some(entry => !entry.restored), false)
    const result = await checkLostWrappers({ config, p, plan, batch: "01", migrated: ["main.vibe"], emittedJs, ts, logs })
    assert.deepEqual(result.blocking.map(f => f.function), ["/f"], JSON.stringify(result))
    assert.equal(existsSync(join(target, ".vibelang/js/main.js")), false)
    assert.equal(existsSync(join(p.batch("01"), "lost-wrapper-js", slug("."), "main.js")), true)
  })
})

test("a private package without exports uses normal emission and keeps the lost-wrapper gate", async () => {
  await inFixture({ before, emitted: "export const f = () => 1;\n", exportsJs: false }, async ({ run, target, p }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.lostWrappers, false)
    assert.deepEqual(result.lostWrappers.blocking.map(f => f.function), ["/f"], JSON.stringify(result.lostWrappers))
    assert.equal(existsSync(join(target, ".vibelang/js/main.js")), true)
    assert.equal(existsSync(join(p.batch("01"), "lost-wrapper-js", slug("."), "main.js")), false)
  })
})

test("a module this run's codemod never renamed has no original to compare and is listed, not stopped, as run-phase does", () => {
  const result = lostWrapperCheck({ ts, files: ["src/old.vibe", "src/lost.vibe"], original: () => null, emitted: () => null, renamed: file => file === "src/lost.vibe" })
  assert.deepEqual(result.noOriginal, ["src/old.vibe"])
  assert.deepEqual(result.unchecked.map(u => [u.file, u.reason]), [["src/lost.vibe", "no original text retained for it"]])
})

test("verify passes a batch whose module the codemod never renamed (a fixture or a hand rename): nothing to compare", async () => {
  await inFixture({ before, emitted: "", exportsJs: true }, async ({ run, p }) => {
    writeJson(p.codemodState("01"), { version: 1, phase: "fixing", files: ["main.ts"], renames: [], originals: [] })
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.lostWrappers, true, JSON.stringify(result.lostWrappers))
    assert.deepEqual(result.lostWrappers.noOriginal, ["main.vibe"])
  })
})

test("verify stops a batch that the check cannot read, with the reason", async () => {
  await inFixture({ before, emitted: "", exportsJs: true }, async ({ run, p }) => {
    writeJson(p.codemodState("01"), { version: 1, phase: "fixing", files: ["main.ts"], renames: [{ from: "main.ts", to: "main.vibe" }], originals: [] })
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.lostWrappers, false)
    assert.deepEqual(result.lostWrappers.unchecked.map(u => u.file), ["main.vibe"])
  })
})

test("overloads: bodyless signatures take no ordinal, so the one body pairs with the emitted function (opencode llm generate)", () => {
  const original = header + `export function generate(x: string): Effect.Effect<string>
export function generate(x: number): Effect.Effect<number>
export function generate(x: string | number) { return Effect.succeed(x) }
`
  assert.deepEqual([...functionsOf(ts, original).keys()], ["/generate"])
  assert.deepEqual(flagged(original, jsHeader + `export function generate(x) { return Effect.succeed(x); }\n`), [])
  assert.deepEqual(flagged(original, jsHeader + `export function generate(x) { return x; }\n`), ["/generate 1->0"])
})

test("a callback's Effect.gen pairs with the emit's fnUntraced generator in the same argument (opencode resolve, executeTool)", () => {
  const original = header + `declare const register: any
export const install = () => register("tool", (input: string) => Effect.gen(function* () { return input }))
`
  const emitted = jsHeader + `export const install = () => register("tool", Effect.fnUntraced(function* (input) { return input; }));\n`
  const result = scan(original, emitted)
  assert.deepEqual(result.flags, [])
  assert.deepEqual(result.unpaired, [])
  assert.deepEqual(flagged(original, jsHeader + `export const install = () => register("tool", (input) => input);\n`), ["/install/register(1) 1->0"])
})

test("a pipeline lowered data-first inlines its callback: the predicate keeps its own path, nothing mispairs (alchemy gcp Compute)", () => {
  const original = header + `declare const get: any, ok: any
export const read = (id: string) => get(id).pipe(Effect.flatMap((r: any) => Effect.succeed(r.body)), Effect.filterOrFail((b: any) => ok(b), () => "bad"))
`
  const emitted = jsHeader + `export const read = Effect.fnUntraced(function* (id) { return yield* Effect.filterOrFail(Effect.gen(function* () { const r = yield* get(id); return r.body; }), (b) => ok(b), () => "bad"); });\n`
  const result = scan(original, emitted)
  assert.deepEqual(result.flags, [])
  // The factory around it is still a program, so the callback is inlined, never paired with the predicate.
  assert.deepEqual(result.unpaired, [])
  assert.deepEqual(result.inlined.map(u => u.function), ["/read/get().pipe(0)/Effect.flatMap(0)"])
})

test("a list method's Effect.gen inlined into the enclosing generator never pairs with a later data callback (alchemy MailManager, EC2)", () => {
  const original = header + `declare const call: any, pages: any
export const svc = {
  list: () => Effect.gen(function* () { const chunk = yield* call(); return chunk }).pipe(Effect.flatMap((chunk: any) => Effect.forEach(chunk, (c: any) => Effect.succeed(c)))),
  names: () => pages.flatMap((page: any) => page.names),
}
`
  const emitted = jsHeader + `export const svc = {
    list: Effect.fnUntraced({ *list() { const chunk = yield* call(); return yield* Effect.forEach(chunk, (c) => Effect.succeed(c)); } }.list),
    names: () => pages.flatMap((page) => page.names),
};
`
  const result = scan(original, emitted)
  assert.deepEqual(result.flags, [])
  assert.ok(!result.unpaired.some(u => u.function.startsWith("/svc/names")), JSON.stringify(result.unpaired))
})

test("a returned Effect.fn emitted as a named fnUntraced generator pairs, and its inner callback keeps its own path (alchemy aws BindingHttp)", () => {
  const original = header + `declare const Output: any
export const bind = (o: any) => { return Effect.fn(function* (x: string) { return yield* Output.map(o, (arn: string) => arn + x) }) }
`
  const emitted = jsHeader + `export const bind = (o) => { return Effect.fnUntraced(function* bind_fn(x) { return yield* Output.map(o, (arn) => arn + x); }); };\n`
  const result = scan(original, emitted)
  assert.deepEqual(result.flags, [])
  assert.deepEqual(result.unpaired, [])
})

test("a record of Effect.fn members returns no program: each member pairs with its own emitted function (t3code persistQuery)", () => {
  const original = `import * as Effect from "effect/Effect";
export function make() { return { load: Effect.fn("fixture.load")(function* () { return 1 }), save: Effect.fnUntraced(function* () { return 2 }) } }`
  const emitted = `import * as Effect from "effect/Effect";
export function make() { return { load: () => Effect.withSpan(Effect.gen(function* () { return 1 }), "fixture.load"), save: Effect.fnUntraced(function* () { return 2 }) }; }`
  assert.deepEqual(lostWrappers({ ts, original, emitted }).flags, [])
})

test("a record member that lost its Effect.fn still flags at that member", () => {
  const original = `import * as Effect from "effect/Effect";
export const make = () => ({ load: Effect.fnUntraced(function* () { return 1 }) })`
  const emitted = `export const make = () => ({ load: () => 1 });`
  assert.deepEqual(lostWrappers({ ts, original, emitted }).flags.map(f => f.function), ["/make/load"])
})

test("a record member holding a program still counts for the function that returns it", () => {
  const original = `import * as Effect from "effect/Effect";
export const make = () => ({ program: Effect.succeed(1) })`
  const emitted = `export const make = () => ({ program: 1 });`
  assert.deepEqual(lostWrappers({ ts, original, emitted }).flags.map(f => f.function), ["/make"])
})

test("a branch emitted as an inline call keeps its program (t3code Crypto randomBytes)", () => {
  const original = `import * as Effect from "effect/Effect";
export const make = (valid) => valid ? Effect.succeed(1) : Effect.fail("bad");`
  const emitted = `import * as Effect from "effect/Effect";
export const make = (valid) => valid ? Effect.gen(function* () { return 1 }) : (() => { const error = "bad"; return Effect.gen(function* () { throw error }); })();`
  assert.deepEqual(lostWrappers({ ts, original, emitted }).flags, [])
})

test("an inline call that hands back a plain value, an async inline call and a throwing one still flag", () => {
  const original = `import * as Effect from "effect/Effect";
export const make = () => Effect.succeed(1);`
  for (const body of ["(() => { return 1; })()", "(async () => { return Effect.succeed(1); })()", "(() => { throw 1; })()"])
    assert.deepEqual(lostWrappers({ ts, original, emitted: `export const make = () => ${body};` }).flags.map(f => f.function), ["/make"], body)
})

test("a do temporary hands back what it was assigned (t3code effect-acp callRpc)", () => {
  const original = `import * as Effect from "effect/Effect";
export const callRpc = (effect) => Effect.mapError(effect, String);`
  const emitted = `import * as Effect from "effect/Effect";
export const callRpc = (effect) => { let $do1; { const caught = effect; $do1 = Effect.gen(function* () { return yield* caught }); } return $do1; };`
  assert.deepEqual(lostWrappers({ ts, original, emitted }).flags, [])
})

test("a local hands back what it holds, and one holding a plain value or a cycle still flags", () => {
  const original = `import * as Effect from "effect/Effect";
export const callRpc = () => Effect.succeed(1);`
  const kept = `import * as Effect from "effect/Effect";
export const callRpc = () => { const first = Effect.succeed(1); const program = first; return program; };`
  assert.deepEqual(lostWrappers({ ts, original, emitted: kept }).flags, [])
  for (const emitted of [`export const callRpc = () => { let $do1; { $do1 = 1; } return $do1; };`,
    `export const callRpc = () => { const value = 1; return value; };`,
    `export const callRpc = () => { let a, b; a = b; b = a; return a; };`])
    assert.deepEqual(lostWrappers({ ts, original, emitted }).flags.map(f => f.function), ["/callRpc"], emitted)
})

test("a local holding what Effect.fn made is a function, not a program", () => {
  const original = `import * as Effect from "effect/Effect";
export const make = () => { const run = Effect.fn("x")(function* () { return 1 }); return run; };`
  const emitted = `import * as Effect from "effect/Effect";
export const make = () => { const run = () => Effect.withSpan(Effect.succeed(1), "x"); return run; };`
  assert.deepEqual(lostWrappers({ ts, original, emitted }).flags, [])
})

test("a program the function runs is no Effect return, spelled either way (t3code isRelayTracingEnabled)", () => {
  const original = `import * as Effect from "effect/Effect";
export const piped = (flag) => read(flag).pipe(Effect.orDie, Effect.runSync);
export const called = (flag) => Effect.runSync(read(flag));`
  const emitted = `import * as Effect from "effect/Effect";
export const piped = (flag) => (() => { const pipe$stage0 = Effect.orDie; const pipe$stage1 = Effect.runSync; return pipe$stage1(pipe$stage0(read(flag))); })();
export const called = (flag) => (() => { const run = Effect.runSync; return run(read(flag)); })();`
  assert.deepEqual(lostWrappers({ ts, original, emitted }).flags, [])
})

test("a pipeline that keeps its program still counts when it loses the wrapper", () => {
  const original = `import * as Effect from "effect/Effect";
export const piped = (flag) => read(flag).pipe(Effect.orDie);`
  assert.deepEqual(lostWrappers({ ts, original, emitted: `export const piped = (flag) => read(flag).pipe(orDie);` }).flags.map(f => f.function), ["/piped"])
})

test("an Effect type in a cast or type argument is no Effect return (alchemy drizzle proxyChain)", () => {
  const original = header + `declare const proxyChain: any
export const chain = (db: unknown) => proxyChain<Effect.Effect<number>>(db as Effect.Effect<number>)
`
  assert.deepEqual(flagged(original, jsHeader + `export const chain = (db) => proxyChain(db);\n`), [])
})

// t3code DesktopWindow: the codemod spells `onSome: Effect.succeed` as a forwarding arrow.
const flagsOf = (original, emitted) => lostWrappers({ ts, original, emitted }).flags.map(flag => flag.function)
const matched = onSome => `import { Effect, Option } from "effect"\nexport const f = (x: Option.Option<number>) => Option.match(x, { onNone: () => Effect.interrupt, onSome: ${onSome} })\n`
test("a member named in an arm and forwarded in the emit is one read (t3code requireWindow)", () => {
  assert.deepEqual(flagsOf(matched("Effect.succeed"), matched("(value) => Effect.succeed(value)").replace("(x: Option.Option<number>)", "(x)")), [])
  assert.deepEqual(flagsOf(matched("Effect.succeed"), matched("function (value) { return Effect.succeed(value) }").replace("(x: Option.Option<number>)", "(x)")), [])
  assert.deepEqual(flagsOf(matched("(value: number) => Effect.succeed(value)"), matched("(value) => Effect.succeed(value)").replace("(x: Option.Option<number>)", "(x)")), [])
  assert.deepEqual(flagsOf(matched("Effect.succeed"), matched("Effect.succeed").replace("(x: Option.Option<number>)", "(x)")), [])
})
test("a dropped member, another member or a changed forward still flags", () => {
  const emitted = onSome => matched(onSome).replace("(x: Option.Option<number>)", "(x)")
  for (const onSome of ["(value) => value", "(value) => Effect.fail(value)", "(value) => Effect.succeed(1)", "(value, other) => Effect.succeed(other, value)", "(value = 1) => Effect.succeed(value)", "async (value) => Effect.succeed(value)", "(...value) => Effect.succeed(value)"])
    assert.deepEqual(flagsOf(matched("Effect.succeed"), emitted(onSome)), ["/f"], onSome)
  assert.deepEqual(flagsOf(`import { Effect } from "effect"\nexport const f = (x: number) => Effect.succeed(x)\n`, `import { Effect } from "effect"\nexport const f = (x) => (value) => Effect.succeed(value)\n`), ["/f"])
  assert.deepEqual(flagsOf(`import { Effect } from "effect"\nexport const f = (x: boolean) => x ? Effect.void : 1\n`, `import { Effect } from "effect"\nexport const f = (x) => x ? 0 : 1\n`), ["/f"])
})

// alchemy-lost-wrapper-module-pairing (6 partition sources: sql Records and
// SqlFile, docker BuildHash among them): a platform or throwing split moves
// declarations verbatim into a VIP-40 body, which the compiler emits beside
// the module as x.vibe.<body>.js, and the module only imports or re-exports
// them. The check read the module's own JavaScript, so every moved
// Effect-returning function was unpaired.
const bodyModule = `export { f, h } from "./x.vibe.platform.js";\nimport { f as local } from "./x.vibe.platform.js";\nexport const k = () => local();\n`
const bodyOriginal = header + `const f = () => Effect.succeed(1)\nconst g = (n: number) => Effect.succeed(n)\nexport { f, g as h }\nexport const k = () => f()\n`
const bodyCheck = (companion, read) => lostWrapperCheck({
  ts, files: ["src/x.vibe"],
  original: () => ({ path: "src/x.ts", text: bodyOriginal }),
  emitted: () => ({ path: "/out/src/x.js", text: bodyModule }),
  read: read ?? (path => path === "/out/src/x.vibe.platform.js" ? companion : null),
})

test("corpus: a module body's functions pair with the original's, from the body's emitted companion", () => {
  const result = bodyCheck(jsHeader + `export const f = () => Effect.succeed(1);\nconst g = (n) => Effect.succeed(n);\nexport { g as h };\n`)
  assert.deepEqual(result.unpaired, [])
  assert.deepEqual(result.blocking, [])
  assert.equal(result.paired, 3)
})

test("a body function that lost its wrapper is flagged, as one in the module is", () => {
  const result = bodyCheck(jsHeader + `export const f = () => 1;\nconst g = (n) => Effect.succeed(n);\nexport { g as h };\n`)
  assert.deepEqual(result.blocking.map(f => [f.file, f.function, f.effectReturns, f.emittedEffectReturns]), [["src/x.vibe", "/f", 1, 0]])
})

test("with no companion on disk, the body's functions stay unpaired", () => {
  const result = bodyCheck(null, () => null)
  assert.deepEqual(result.unpaired.map(u => u.function).sort(), ["/f", "/g"])
})

test("only a body of this module counts: another module's companion and a non-body import are not read", () => {
  const read = []
  lostWrapperCheck({
    ts, files: ["src/x.vibe"],
    original: () => ({ path: "src/x.ts", text: header + `export const f = () => Effect.succeed(1)\n` }),
    emitted: () => ({ path: "/out/src/x.js", text: `export { f } from "./y.vibe.platform.js";\nimport "./x.helpers.js";\nimport "./x.vibe.not-a-body.js";\n` }),
    read: path => { read.push(path); return null },
  })
  assert.deepEqual(read, [])
})

// alchemy-lost-wrapper-inlining-pairing (9 partition sources: alchemy-test
// Http, cloudflare-test-tools e2e/Vite, git Engine among them): direct-style
// lowering inlines a pipeline callback into the program around it, so the
// callback has no emitted function and was listed unpaired, though its
// Effects are that program's steps.
const inliningOriginal = header + `export const program = Effect.succeed(1).pipe(\n  Effect.flatMap(n => Effect.succeed(n + 1))\n)\nexport const f = (s: string) => Effect.succeed(s).pipe(Effect.map((n) => n.length), Effect.flatMap((k) => Effect.succeed(k * 2)))\n`
const inliningEmitted = `import * as Effect_1 from "effect/Effect";\nimport * as Effect from "effect/Effect";\nexport const program = Effect_1.gen(function* program() {\n    const n = yield* Effect.succeed(1);\n    return n + 1;\n});\nexport const f = (s) => Effect_1.gen(function* () {\n    const n = yield* Effect.succeed(s);\n    const k = n.length;\n    return k * 2;\n});\n`

test("corpus: a callback inlined into the program around it is inlined, not unpaired", () => {
  const { flags, unpaired, inlined } = scan(inliningOriginal, inliningEmitted)
  assert.deepEqual(flags, [])
  assert.deepEqual(unpaired, [])
  assert.deepEqual(inlined.map(i => i.function), ["/program/Effect.succeed().pipe(0)/Effect.flatMap(0)", "/f/Effect.succeed().pipe(1)/Effect.flatMap(0)"])
})

test("a callback whose holder is no longer a program stays unpaired, and a holder that lost its program is flagged", () => {
  const plainValue = scan(inliningOriginal, jsHeader + `export const program = 2;\nexport const f = (s) => Effect.gen(function* () { return s.length * 2; });\n`)
  assert.deepEqual(plainValue.unpaired.map(u => u.function), ["/program/Effect.succeed().pipe(0)/Effect.flatMap(0)"])
  const lostHolder = scan(inliningOriginal, inliningEmitted.replace(/export const f = [\s\S]*$/, "export const f = (s) => s.length * 2;\n"))
  assert.deepEqual(lostHolder.flags.map(f => f.function), ["/f"])
  assert.deepEqual(lostHolder.unpaired.map(u => u.function), ["/f/Effect.succeed().pipe(1)/Effect.flatMap(0)"])
})

test("property: lowering a pipeline into the program around it inlines its callbacks; lowering it to a value leaves them unpaired", () => {
  const fc = require("fast-check")
  const steps = {
    flatMap: (i) => [`Effect.flatMap((v${i}) => Effect.succeed(v${i} + ${i}))`, `const v${i + 1} = yield* Effect.succeed(v${i} + ${i});`, true],
    map: (i) => [`Effect.map((v${i}) => v${i} + ${i})`, `const v${i + 1} = v${i} + ${i};`, false],
    andThen: (i) => [`Effect.andThen((v${i}) => Effect.succeed(v${i} * ${i + 1}))`, `const v${i + 1} = yield* Effect.succeed(v${i} * ${i + 1});`, true],
  }
  const holders = {
    value: (pipe, gen) => [`export const h = ${pipe}\n`, `export const h = Effect.gen(function* () { ${gen} });\n`, `export const h = 0;\n`],
    fn: (pipe, gen) => [`export const h = (v0: number) => ${pipe}\n`, `export const h = (v0) => Effect.gen(function* () { ${gen} });\n`, null],
    property: (pipe, gen) => [`export const o = { h: ${pipe} }\n`, `export const o = { h: Effect.gen(function* () { ${gen} }) };\n`, `export const o = { h: 0 };\n`],
  }
  fc.assert(fc.property(fc.constantFrom(...Object.keys(holders)), fc.array(fc.constantFrom(...Object.keys(steps)), { minLength: 1, maxLength: 4 }), (holder, chain) => {
    const built = chain.map((key, i) => steps[key](i))
    const start = holder === "fn" ? "Effect.succeed(v0)" : "Effect.succeed(0)"
    const pipe = `${start}.pipe(${built.map(([p]) => p).join(", ")})`
    const gen = `let v0 = ${holder === "fn" ? "v0" : "0"}; ${built.map(([, g]) => g).join(" ")} return v${chain.length};`.replace(/^let v0 = v0; /, "")
    const [original, lowered, plain] = holders[holder](pipe, gen)
    const effectful = built.filter(([, , effect]) => effect).length
    const ok = scan(header + original, jsHeader + lowered)
    assert.deepEqual(ok.flags, [], lowered)
    assert.deepEqual(ok.unpaired, [], lowered)
    assert.equal(ok.inlined.length, effectful, lowered)
    if (plain) {
      const lost = scan(header + original, jsHeader + plain)
      assert.equal(lost.unpaired.length, effectful, plain)
      assert.deepEqual(lost.inlined, [], plain)
    }
  }), { seed: 4402, numRuns: 120 })
})

test("a curried Effect operator applied through a local keeps the program (t3code client-runtime driver)", () => {
  const original = `import * as Effect from "effect/Effect";
const descriptor = Effect.fnUntraced(function* () { return 1; });
export const factory = () => descriptor().pipe(Effect.withSpan("check"));
export const piped = (flag) => read(flag).pipe(Effect.orDie);`
  for (const emitted of [`import * as Effect from "effect/Effect";
const descriptor = Effect.fnUntraced(function* () { return 1; });
export const factory = () => (() => { const program = descriptor(); const stage = Effect.withSpan("check"); return stage(program); })();
export const piped = (flag) => (() => { const pipe$stage0 = Effect.orDie; return pipe$stage0(read(flag)); })();`,
  `import { withSpan, orDie, fnUntraced } from "effect/Effect";
const descriptor = fnUntraced(function* () { return 1; });
export const factory = () => { const value = (() => (() => { const first = descriptor(); const program = first; const stage = withSpan("check"); return stage(program); })())(); return value; };
export const piped = (flag) => (() => { const pipe$stage0 = orDie; return pipe$stage0(read(flag)); })();`])
    assert.deepEqual(lostWrappers({ ts, original, emitted }).flags, [], emitted)
})

test("a local that is no Effect operator still loses the wrapper", () => {
  const original = `import * as Effect from "effect/Effect";
export const factory = (program) => program.pipe(Effect.withSpan("check"));`
  for (const stage of [`const stage = Effect.runSync;`, `const stage = Effect.isEffect;`, `const stage = Effect.fn("x");`, `const stage = helper(Effect.succeed(1));`,
    `let stage = Effect.withSpan("check"); stage = (x) => 1;`, `const stage = Effect.withSpan("check"); { const stage = (x) => 1; }`])
    assert.deepEqual(lostWrappers({ ts, original, emitted: `import * as Effect from "effect/Effect";
export const factory = (program) => (() => { ${stage} return stage(program); })();` }).flags.map(f => f.function), ["/factory"], stage)
})

test("an inline stage that passes the program through a plain helper keeps it (t3code GitHubPullRequestApi)", () => {
  const original = `import * as Effect from "effect/Effect";
const through = <A>(program: A): A => program;
export const factory = (on = true) => {
  if (!on) return Effect.succeed(null);
  return Effect.succeed(1).pipe((program) => through(program));
};`
  for (const stage of [`((program) => through(program))`, `((program) => program)`, `((program) => { const kept = through(program); return kept; })`])
    assert.deepEqual(lostWrappers({ ts, original, emitted: `import * as Effect from "effect/Effect";
const through = (program) => program;
export const factory = (on = true) => {
  if (!on) return Effect.succeed(null);
  return ${stage}(Effect.succeed(1));
};` }).flags, [], stage)
})

test("an inline stage that runs, drops or never names the program still loses the wrapper", () => {
  const original = `import * as Effect from "effect/Effect";
const through = <A>(program: A): A => program;
export const factory = (on = true) => {
  if (!on) return Effect.succeed(null);
  return Effect.succeed(1).pipe((program) => through(program));
};`
  for (const stage of [`((program) => Effect.runSync(program))(Effect.succeed(1))`, `((program) => program.pipe(Effect.runSync))(Effect.succeed(1))`,
    `((program) => through(1))(Effect.succeed(1))`, `((program) => through(other))(Effect.succeed(1))`, `((program) => () => program)(Effect.succeed(1))`,
    `((program) => through(program))(1)`, `((value, program) => through(value))(1, Effect.succeed(1))`])
    assert.deepEqual(lostWrappers({ ts, original, emitted: `import * as Effect from "effect/Effect";
const through = (program) => program;
export const factory = (on = true) => {
  if (!on) return Effect.succeed(null);
  return ${stage};
};` }).flags.map(f => f.function), ["/factory"], stage)
})

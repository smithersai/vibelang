import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { applyState, prepareState } from "../lib/codemod-state.mjs"

// alchemy-plain-native-peer-resolution: prepareState rewrites the batch's
// imports to its renamed modules before the legacy plain marks read types,
// so a consumer converted with its peer imported ./peer.vibe, which stock
// TypeScript cannot read before the compiler writes its declarations. Every
// import of the peer read as any, and a function returning the peer's Effect
// was marked `: infer _`, a plain function, which then failed EK9203. The
// marks now read the peer from the source it is renamed from.

const runtime = new URL("../../../../packages/runtime/", import.meta.url)
const require = createRequire(new URL("package.json", runtime))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-plain-native-peer.json", import.meta.url), "utf8"))
// The legacy marks are for a compiler before VIP-1's flip, such as the
// pinned VibeLang 0.0.11; a flipped compiler rejects every `infer _` (TS1338).
const compiler = process.env.VIBELANG_LEGACY_BINARY

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "plain-native-peer-"))
  symlinkSync(join(runtime.pathname, "node_modules"), join(root, "node_modules"))
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", private: true, type: "module" }))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "Preserve", moduleResolution: "Bundler", target: "ESNext", noEmit: true, allowArbitraryExtensions: true, allowImportingTsExtensions: true, skipLibCheck: true, types: [] }, include: ["src"] }))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

// The consumer's text after the legacy marks, with selected in the batch.
function marked(files, selected, consumer) {
  const root = project(files)
  try {
    const state = prepareState(root, selected, Object.keys(files), { ts, plainGroups: [{ files: selected, tsconfigs: ["tsconfig.json"], flipped: false }] })
    const write = state.writes.find((w) => w.file === consumer.replace(/\.ts$/, ".vibe").replace(/\.tsx$/, ".vibex") || w.file === consumer)
    return { text: write?.after ?? files[consumer], state, root }
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error }
}
const marks = (text) => [...text.matchAll(/\): infer _/g)].length
const withoutSpecifiers = (text) => text.replace(/from "\.\/[^"]+"/g, "from \"./peer\"")

const peer = 'import * as Effect from "effect/Effect";\nexport const consume = (n: number) => Effect.succeed(n);\nexport const label = (n: number) => "n" + n;\n'
const consumer = 'import { consume, label } from "./peer.ts";\nexport const program = (n: number) => consume(n);\nexport const name = (n: number) => label(n);\n'

test("a consumer converted with its peer keeps the peer's Effect return and marks only its value helper", () => {
  const { text, root } = marked({ "src/peer.ts": peer, "src/consumer.ts": consumer }, ["src/peer.ts", "src/consumer.ts"], "src/consumer.ts")
  rmSync(root, { recursive: true, force: true })
  assert.match(text, /from "\.\/peer\.vibe"/)
  assert.match(text, /^export const program = \(n: number\) => consume\(n\);$/m)
  assert.match(text, /^export const name = \(n: number\): infer _ => label\(n\);$/m)
})

test("a peer outside the batch and a JSX peer the batch renames give the same marks", () => {
  const alone = marked({ "src/peer.ts": peer, "src/consumer.ts": consumer }, ["src/consumer.ts"], "src/consumer.ts")
  rmSync(alone.root, { recursive: true, force: true })
  const jsx = marked({ "src/peer.tsx": peer, "src/consumer.ts": consumer.replace("./peer.ts", "./peer.tsx") }, ["src/peer.tsx", "src/consumer.ts"], "src/consumer.ts")
  rmSync(jsx.root, { recursive: true, force: true })
  assert.match(jsx.text, /from "\.\/peer\.vibex"/)
  assert.equal(marks(alone.text), 1)
  assert.equal(withoutSpecifiers(jsx.text), withoutSpecifiers(alone.text))
})

// Peer exports and the consumer forms that call them.
const exportsOf = [
  ["effect", "(n: number) => Effect.succeed(n)"],
  ["stream", "(n: number) => Stream.make(n)"],
  ["value", "(n: number) => n + 1"],
  ["union", "(n: number) => (n > 0 ? Effect.succeed(n) : Effect.fail(\"negative\"))"],
  ["rest", "(...args: any[]) => Effect.succeed(args.length)"],
]
const forms = [
  (name, i) => `export const c${i} = (n: number) => ${name}(n);`,
  (name, i) => `export function c${i}(n: number) { return ${name}(n) }`,
  (name, i) => `export const c${i} = <R = never>(n: number) => ${name}(n);`,
  (name, i) => `export class K${i} { run(n: number) { return ${name}(n) } }`,
]
test("the marks of a consumer do not depend on whether its peer is converted with it", () => {
  fc.assert(fc.property(fc.array(fc.record({ exp: fc.integer({ min: 0, max: exportsOf.length - 1 }), form: fc.integer({ min: 0, max: forms.length - 1 }) }), { minLength: 1, maxLength: 5 }), (picks) => {
    const peerText = 'import * as Effect from "effect/Effect";\nimport * as Stream from "effect/Stream";\n' +
      exportsOf.map(([name, body]) => `export const ${name} = ${body};`).join("\n") + "\n"
    const used = [...new Set(picks.map((p) => exportsOf[p.exp][0]))]
    const consumerText = `import { ${used.join(", ")} } from "./peer.ts";\n` + picks.map((p, i) => forms[p.form](exportsOf[p.exp][0], i)).join("\n") + "\n"
    const files = { "src/peer.ts": peerText, "src/consumer.ts": consumerText }
    const together = marked(files, ["src/peer.ts", "src/consumer.ts"], "src/consumer.ts")
    rmSync(together.root, { recursive: true, force: true })
    const alone = marked(files, ["src/consumer.ts"], "src/consumer.ts")
    rmSync(alone.root, { recursive: true, force: true })
    assert.equal(withoutSpecifiers(together.text), withoutSpecifiers(alone.text), consumerText)
  }), { numRuns: 40, seed: 9203001 })
})

// A peer converted in an earlier pass is a .vibe file; with no declaration
// beside it the program cannot read it, and its return type is unknown, not
// a value. The compiler reads the peer, so the marks leave such callers to it.
const nativePeer = 'export const consume = (n: number) => Effect.succeed(n);\nexport const label = (n: number) => "n" + n;\n'
const nativeConsumer = consumer.replace("./peer.ts", "./peer.vibe")
const peerSidecar = 'import type * as Effect from "effect/Effect";\nexport declare const consume: (n: number) => Effect.Effect<number>;\nexport declare const label: (n: number) => string;\n'
test("a consumer of a native peer it cannot read leaves the peer's calls to the compiler; a declaration decides", () => {
  const unread = marked({ "src/peer.vibe": nativePeer, "src/consumer.ts": nativeConsumer }, ["src/consumer.ts"], "src/consumer.ts")
  rmSync(unread.root, { recursive: true, force: true })
  assert.equal(marks(unread.text), 0, unread.text)
  assert.deepEqual(unread.state.plain["src/consumer.ts"]?.unread, [2, 3])
  const declared = marked({ "src/peer.vibe": nativePeer, "src/peer.d.vibe.ts": peerSidecar, "src/consumer.ts": nativeConsumer }, ["src/consumer.ts"], "src/consumer.ts")
  rmSync(declared.root, { recursive: true, force: true })
  assert.match(declared.text, /^export const program = \(n: number\) => consume\(n\);$/m)
  assert.match(declared.text, /^export const name = \(n: number\): infer _ => label\(n\);$/m)
})

test("only callers of an unread native peer are left unmarked; other value helpers keep their marks", () => {
  fc.assert(fc.property(fc.array(fc.record({ form: fc.integer({ min: 0, max: forms.length - 1 }), peer: fc.boolean() }), { minLength: 1, maxLength: 5 }), fc.boolean(), (picks, namespace) => {
    const head = namespace ? 'import * as Peer from "./peer.vibe";\n' : 'import { consume } from "./peer.vibe";\n'
    const callee = namespace ? "Peer.consume" : "consume"
    const consumerText = head + picks.map((p, i) => forms[p.form](p.peer ? callee : "inc", i)).join("\n") + "\nconst inc = (n: number) => n + 1;\n"
    const { text, state, root } = marked({ "src/peer.vibe": nativePeer, "src/consumer.ts": consumerText }, ["src/consumer.ts"], "src/consumer.ts")
    rmSync(root, { recursive: true, force: true })
    const lines = text.split("\n")
    picks.forEach((p, i) => {
      const line = lines.find((l) => l.includes("c" + i + "(") || l.includes("c" + i + " =") || l.includes("K" + i + " "))
      assert.ok(line, text)
      assert.equal(/infer _/.test(line), !p.peer, line)
    })
    assert.equal((state.plain["src/consumer.ts"]?.unread ?? []).length, picks.filter((p) => p.peer).length)
  }), { numRuns: 40, seed: 9203002 })
})

test("alchemy corpus: event-source consumers converted with their peer stay Effect functions", () => {
  for (const { key, files, selected, consumer, plain, effect } of corpus.cases) {
    const { text, root } = marked(files, selected, consumer)
    rmSync(root, { recursive: true, force: true })
    for (const name of effect) assert.doesNotMatch(text, new RegExp("export const " + name + " = [^\\n]*\\): infer _"), key + ": " + name)
    for (const name of plain) assert.match(text, new RegExp("export const " + name + " = [^\\n]*\\): infer _"), key + ": " + name)
  }
})

test("with a legacy-inference compiler the converted consumer compiles without EK9203", { skip: !compiler && "set VIBELANG_LEGACY_BINARY" }, () => {
  const { state, root } = marked({ "src/peer.ts": peer, "src/consumer.ts": consumer }, ["src/peer.ts", "src/consumer.ts"], "src/consumer.ts")
  try {
    applyState(root, state)
    const result = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.doesNotMatch(result.stdout + result.stderr, /EK9203/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

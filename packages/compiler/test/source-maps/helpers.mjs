// The fixture every tool test drives, and the checks that read a source map at
// both ends. Positions here come from searching the two texts, never from the
// compiler: the rules they check are in docs/maintainers/source-maps.md.
import { strict as assert } from "node:assert"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { GREATEST_LOWER_BOUND, LEAST_UPPER_BOUND, TraceMap, originalPositionFor } from "@jridgewell/trace-mapping"
import { SourceMapConsumer } from "source-map"

export const here = fileURLToPath(new URL(".", import.meta.url))
export const fixtures = join(here, ".fixtures")
export const compiler = process.env.VIBELANG_BINARY ?? join(here, "../../native/vibelang")
/** A plugin's module, from the private copy run.sh makes. */
export const plugin = (path) => join(fixtures, "plugins", path)

export const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true,
    types: [], lib: ["ES2022", "DOM"], sourceMap: true, inlineSources: true, outDir: "out", rootDir: "src", declaration: false
  },
  include: ["src"]
})

// Types vanish and the lowering adds lines, so the emitted lines differ from
// these. The emoji sit before a token on its line: only UTF-16 columns reach it.
// No function is a tail call or a bare value: Bun's engine drops a tail call's
// frame, and its transpiler inlines a function that only returns a value.
export const mainVibe = `// A comment, types and declarations before the code.
interface Box {
  readonly value: number
}
type Alias = Box | null

export error Refused { reason: string }

export schema Point { x: number; label: string }

function leaf(label: string): Error {
  const emoji = "\u{1F600}\u{1F600}"; const made = new Error("MARK_LEAF" + emoji + label)
  return made.message.length > 0 ? made : new Error("empty")
}

function middle(label: string): Error {
  const made = leaf(label + "-m")
  return made.message.length > 0 ? made : new Error("empty")
}

export function plainTrace(): Error {
  const made = middle("p")
  return made.message.length > 0 ? made : new Error("empty")
}

export effect function failing(limit: number) {
  const first = try succeed(limit)
  const value = do { const doubled = first * 2; doubled + 1 }
  const picked = match (value) { when 3: "MARK_MATCH"; default: "MARK_OTHER"; }
  const recovered = fail(new Refused({ reason: picked })) catch (e) => e.reason
  const piped = try (succeed(recovered) |> map(%, (text) => text + "MARK_PIPE"))
  return try Effect.die(new Error("MARK_DIE" + piped))
}
`

// Runs the fixture and prints both stacks as JSON. It has no top-level await,
// which webpack's CommonJS output cannot run, and it reads every export, which
// keeps them through tree shaking.
export const entry = (main) => `import { Cause, Effect } from "effect"
import * as main from ${JSON.stringify(main)}
Effect.runPromiseExit(main.failing(1)).then((exit) => {
  console.log(JSON.stringify({ exports: Object.keys(main), plain: main.plainTrace().stack, effect: Cause.squash(exit.cause).stack }))
})
`

export function project(t, files = {}) {
  mkdirSync(fixtures, { recursive: true })
  const root = realpathSync(mkdtempSync(join(fixtures, "run-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const all = { "package.json": '{"name":"app","private":true,"type":"module"}', "tsconfig.json": tsconfig, "src/main.vibe": mainVibe, "src/entry.mjs": entry("./main.vibe"), ...files }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

/** Runs a command to its end, with the fixture's cache and compiler. */
export function run(command, args, options = {}) {
  const { cwd, env, input, timeout } = options
  return new Promise((done, failed) => {
    const child = spawn(command, args, {
      cwd, timeout, killSignal: "SIGKILL", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", VIBELANG_BINARY: compiler, VIBELANG_CACHE_DIR: cwd && join(cwd, ".vibelang-cache"), ...env }
    })
    let stdout = "", stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", failed)
    child.on("close", (code, signal) => done({ code, signal, stdout, stderr, output: stdout + stderr }))
    if (input !== undefined) child.stdin.end(input)
  })
}

export async function succeed(command, args, options) {
  const result = await run(command, args, options)
  assert.equal(result.code, 0, `${command} ${args.join(" ")}\n${result.output}`)
  return result
}

const terminator = /\r\n|[\n\r\u2028\u2029]/g

/** The 1-based line and 0-based UTF-16 column of string index `offset`, at ECMA-262's line ends. */
export function position(text, offset) {
  let line = 1, start = 0
  for (const match of text.matchAll(terminator)) {
    if (match.index + match[0].length > offset) break
    line++
    start = match.index + match[0].length
  }
  return { line, column: offset - start }
}

/** Where `needle`, which must occur once, is in `text`. */
export function locate(text, needle, name = "text") {
  const offset = text.indexOf(needle)
  assert.ok(offset >= 0, `${name} has no ${needle}`)
  assert.equal(text.indexOf(needle, offset + 1), -1, `${name} has ${needle} twice`)
  return position(text, offset)
}

/**
 * Both consumers, on one map: the original position of a generated position.
 * @jridgewell/trace-mapping is what Vite, Vitest and Rollup's ecosystem read
 * maps with; source-map is Mozilla's, which Sentry's and Firefox's lines come from.
 */
export async function consumers(map) {
  const trace = new TraceMap(map)
  const mozilla = await new SourceMapConsumer(map)
  return {
    original(position) {
      const a = originalPositionFor(trace, { ...position, bias: GREATEST_LOWER_BOUND })
      const b = mozilla.originalPositionFor({ ...position, bias: SourceMapConsumer.GREATEST_LOWER_BOUND })
      return { trace: a, mozilla: b }
    },
    destroy: () => mozilla.destroy()
  }
}

export { LEAST_UPPER_BOUND }

/**
 * For each marker, the string it starts in the generated code must map to the
 * .vibe position where the source spells it, through both consumers.
 */
export async function assertMarkers(map, code, source, file, markers) {
  const both = await consumers(map)
  try {
    for (const marker of markers) {
      const generated = locate(code, marker, "the generated code")
      const original = locate(source, marker, file)
      const { trace, mozilla } = both.original(generated)
      for (const [name, found] of [["trace-mapping", trace], ["source-map", mozilla]]) {
        assert.equal(relative(dirname(file), found.source ?? "").split("/").pop(), file.split("/").pop(), `${name}: ${marker} names ${found.source}`)
        assert.equal(found.line, original.line, `${name}: the line of ${marker}`)
        // A marker sits after a string's quote, so the segment is the literal's.
        assert.ok(original.column - found.column <= 1 && original.column - found.column >= 0, `${name}: ${marker} is at column ${original.column}, the map says ${found.column}`)
      }
    }
  } finally {
    both.destroy()
  }
}

/** The stack frames of one stack: each frame's file, 1-based line and 1-based column. */
export const frames = (stack) => [...stack.matchAll(/([^\s(]+\.(?:vibex?|m?js|cjs|ts)):(\d+):(\d+)\)?$/gm)]
  .map(([, file, line, column]) => ({ file, line: Number(line), column: Number(column) }))

/** The stack names `needle`'s .vibe position, as a 1-based line and column. */
export function assertFrame(stack, source, needle, file = "main.vibe") {
  const { line, column } = locate(source, needle, file)
  const found = frames(stack).filter((frame) => frame.file.endsWith(file))
  assert.ok(found.some((frame) => frame.line === line && frame.column === column + 1),
    `no frame at ${file}:${line}:${column + 1} (${needle}):\n${stack}`)
}

// A separator in a comment and in a live string, inside code a bundler keeps,
// so every later line of the module counts it.
const separated = (separator) => mainVibe.replace("function middle", `/* one${separator}two */
function middle`).replace('return made.message.length > 0 ? made : new Error("empty")', `const raw = "a${separator}b"; return made.message.length > raw.length ? made : new Error("empty")`)

// The same program in each text the contract names. A map's positions move with
// the text, and each of these moves them a way a wrong count would miss.
export const textVariants = {
  crlf: { text: mainVibe.replaceAll("\n", "\r\n") },
  // The BOM is not part of the text. The token on line 1 sees its column.
  bom: { file: "\uFEFF" + 'export const first = "MARK_BOM"\n' + mainVibe, text: 'export const first = "MARK_BOM"\n' + mainVibe, markers: ["MARK_BOM"] },
  // ECMA-262 ends a line at each of these, and the comment reaches the output.
  "line-separator": { text: "/* one\u2028two */\n" + mainVibe },
  "paragraph-separator": { text: "/* one\u2029two */\n" + mainVibe }
}

/** The stack has a frame on `needle`'s .vibe line. JavaScriptCore puts `new X` at X, so columns differ from V8's. */
export function assertFrameLine(stack, source, needle, file = "main.vibe") {
  const { line } = locate(source, needle, file)
  assert.ok(frames(stack).some((frame) => frame.file.endsWith(file) && frame.line === line), `no frame at ${file}:${line} (${needle}):\n${stack}`)
}

export const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"))

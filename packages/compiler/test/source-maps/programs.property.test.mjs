// Real generated programs, in each text variant, read at both ends by two
// independent consumers, alone and through a bundler. The programs come from
// the fuzz generator (run.sh). Rules: docs/maintainers/source-maps.md.
import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { TraceMap, decodedMappings, originalPositionFor } from "@jridgewell/trace-mapping"
import fc from "fast-check"
import { SourceMapConsumer } from "source-map"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { compiler, fixtures, position, project, run, succeed } from "./helpers.mjs"

const programs = readFileSync(join(fixtures, "programs.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
const bundle = fileURLToPath(new URL("./bundle.mjs", import.meta.url))
const regressions = new URL("./property-regressions/", import.meta.url)
const events = {
  "node_modules/vip-events/package.json": JSON.stringify({ name: "vip-events", type: "module", types: "index.d.ts", exports: { ".": { types: "./index.d.ts", default: "./index.js" } } }),
  "node_modules/vip-events/index.d.ts": "/** @throws {never} */\nexport declare function ev(...values: any[]): any\nexport declare function raise(value: unknown): never\n",
  "node_modules/vip-events/index.js": "export const ev = () => undefined\nexport const raise = (value) => { throw value }\n"
}

const variants = {
  plain: (text) => text,
  crlf: (text) => text.replaceAll("\n", "\r\n"),
  bom: (text) => "\uFEFF" + text,
  astral: (text) => text.replace(/^([ \t]*)(?=\S)/gm, "$1/*\u{1F600}\u{1D49C}*/ "),
  "line-separator": (text) => text.replace(/^([ \t]*)(?=\S)/gm, "$1/*\u2028*/ "),
  // A loader removes the compiler's directive and must leave this one.
  directive: (text) => text + "\nexport const spelled = `first\n//# sourceMappingURL=keep\nlast`\n"
}

// One pass over strings and comments, so neither reads inside the other: a URL
// in a string is no comment, and a quote in a comment opens no string.
const pieces = /"(?:[^"\\\n\r]|\\.)*"|'(?:[^'\\\n\r]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`|\/\*[\s\S]*?\*\/|\/\/[^\n\r\u2028\u2029]*/g
const word = /[A-Za-z_$][\w$]+/g
const blank = (text, keep) => text.replace(pieces, (found) => found.startsWith(keep) ? found : " ".repeat(found.length))

/** The names a text spells once, by where. A string's segment is at its quote, so only names have their own. */
function once(text) {
  const found = new Map()
  for (const match of blank(text, "\0").matchAll(word)) found.set(match[0], found.has(match[0]) ? -1 : match.index)
  return new Map([...found].filter(([, at]) => at >= 0))
}

// Keywords take their position from the segment before them. The runtime's and
// Effect's names can appear in the output with no source of their own, so a
// program that spells one once is no evidence.
const generatedWords = /^(?:fork|join|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|function|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|with|yield|async|from|as|get|set|Effect\w*|runtime|effect|gen|sync|map|flatMap|succeed|fail|die|sleep|ev|raise|vip|events)$/

// A library's member in the output is a helper the lowering chose, whatever the
// program happens to spell: Schema.mutable for a tuple, beside a mutable field.
const helper = /(?:\b(?:Schema|Effect|Data|Option|Exit|Cause|Layer|Stream|runtime)(?:_\d+)?\.)$/

/** The strings a text spells once, by where. */
function quoted(text) {
  const found = new Map()
  for (const match of blank(text, '"').matchAll(/"(?:[^"\\\n\r]|\\.)*"/g)) {
    if (match[0].length > 3) found.set(match[0], found.has(match[0]) ? -1 : match.index)
  }
  return new Map([...found].filter(([, at]) => at >= 0))
}

async function checkMap(map, code, source) {
  const trace = new TraceMap(map)
  const mozilla = await new SourceMapConsumer(map)
  try {
    // Both consumers decode the same segments.
    const ours = decodedMappings(trace).flatMap((line, index) => line.filter((segment) => segment.length > 1)
      .map(([column, , sourceLine, sourceColumn]) => `${index + 1}:${column}=${sourceLine + 1}:${sourceColumn}`))
    const theirs = []
    mozilla.eachMapping((mapping) => {
      if (mapping.source !== null) theirs.push(`${mapping.generatedLine}:${mapping.generatedColumn}=${mapping.originalLine}:${mapping.originalColumn}`)
    }, null, SourceMapConsumer.GENERATED_ORDER)
    assert.deepEqual(new Set(theirs), new Set(ours), "the consumers decode other segments")
    // An import the compiler adds has no segments, and a name in it is not the program's.
    const added = ({ line }) => (decodedMappings(trace)[line - 1] ?? []).length === 0
    // A word each text spells once is the same token: it maps to where it is.
    const inCode = once(code), inSource = once(source)
    let read = 0
    for (const [text, sourceAt] of inSource) {
      const codeAt = inCode.get(text)
      if (codeAt === undefined || generatedWords.test(text)) continue
      const at = position(code, codeAt), want = position(source, sourceAt)
      if (added(at) || helper.test(code.slice(Math.max(0, codeAt - 24), codeAt))) continue
      const first = originalPositionFor(trace, at)
      const second = mozilla.originalPositionFor({ ...at, bias: SourceMapConsumer.GREATEST_LOWER_BOUND })
      assert.deepEqual({ line: first.line, column: first.column }, want, `trace-mapping: ${text} at ${at.line}:${at.column}`)
      assert.deepEqual({ line: second.line, column: second.column }, want, `source-map: ${text} at ${at.line}:${at.column}`)
      read++
    }
    // A string each text spells once keeps its segment at its quote.
    const stringsInCode = quoted(code)
    for (const [text, sourceAt] of quoted(source)) {
      const codeAt = stringsInCode.get(text)
      if (codeAt === undefined) continue
      const at = position(code, codeAt)
      if (added(at)) continue
      const found = originalPositionFor(trace, at)
      assert.deepEqual({ line: found.line, column: found.column }, position(source, sourceAt), `trace-mapping: ${text} at ${at.line}:${at.column}`)
      read++
    }
    return read
  } finally {
    mozilla.destroy()
  }
}

let compiled = 0, wordsRead = 0

async function checkProgram({ program, variant, bundler }) {
  const { key, files } = programs[program % programs.length]
  const apply = variants[variant]
  const texts = Object.fromEntries(Object.entries(files).map(([name, text]) => [name.startsWith("src/") ? name : `src/${name}`, name.endsWith(".vibe") ? apply(text) : text]))
  const root = project({ after() {} }, { ...events, "src/entry.mjs": 'import * as main from "./main.vibe"\nconsole.log(Object.keys(main))\n', ...texts })
  const source = texts["src/main.vibe"].replace(/^\uFEFF/, "")
  const emit = await run(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const output = join(root, "out/main.js")
  // A program with errors or a pending construct emits nothing to read.
  if (!existsSync(output + ".map") || /error (?:TS|EK)/.test(emit.output)) return
  compiled++
  wordsRead += await checkMap(JSON.parse(readFileSync(output + ".map", "utf8")), readFileSync(output, "utf8"), source)
  // Rollup reads JavaScript alone, and some programs import a .ts helper.
  if (bundler === "none" || bundler === "rollup" && Object.keys(files).some((name) => name.endsWith(".ts"))) return
  const built = await run(process.execPath, [bundle, bundler], { cwd: root })
  assert.equal(built.code, 0, `${key}: ${bundler}\n${built.output}`)
  const code = readFileSync(output, "utf8")
  const map = JSON.parse(readFileSync(output + ".map", "utf8"))
  if (variant === "directive") assert.ok(code.includes("//# sourceMappingURL=keep"), `${key}: ${bundler} lost a string's line`)
  const index = map.sources.findIndex((name) => name.endsWith("main.vibe"))
  // A bundler that tree-shook the module leaves nothing to compare.
  if (index >= 0) await checkBundle(map, code, source, index)
}

// Strings survive a bundler, whose map holds one source among others.
async function checkBundle(map, code, source, index) {
  const trace = new TraceMap(map)
  const inCode = quoted(code)
  for (const [text, sourceAt] of quoted(source)) {
    const codeAt = inCode.get(text)
    if (codeAt === undefined) continue
    const found = originalPositionFor(trace, position(code, codeAt))
    if (found.source === null || found.source !== trace.resolvedSources[index]) continue
    assert.equal(found.line, position(source, sourceAt).line, `the bundle's ${text}`)
  }
}

test("generated programs keep their tokens at both ends", async () => {
  await checkProperty(fc, {
    name: "source-map-programs",
    rule: "docs/maintainers/source-maps.md: Rules",
    command: "sh packages/compiler/test/source-maps/run.sh programs.property.test.mjs",
    regressions,
    numRuns: 48,
    arbitrary: fc.record({
      program: fc.nat({ max: programs.length - 1 }),
      variant: fc.constantFrom(...Object.keys(variants)),
      bundler: fc.constantFrom("none", "none", "esbuild", "rollup", "rolldown")
    }),
    check: checkProgram
  })
  assert.ok(compiled > 0, "no generated program compiled")
  assert.ok(wordsRead > compiled, `only ${wordsRead} words read in ${compiled} programs`)
  console.log(`read ${wordsRead} words at both ends in ${compiled} programs`)
})

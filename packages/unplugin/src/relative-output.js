import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { SourceMap } from "node:module"
import MagicString from "magic-string"
import remapping from "@jridgewell/remapping"

const sourceSuffix = /\.(?:vibex?|[cm]?tsx?)$/
const outputSuffix = /\.(?:[cm]?js|jsx)$/
const relativeOutputs = /["'`](\.\.?\/[^"'`\n]*\.(?:[cm]?js|jsx))["'`]/g
function needsOriginalImports(code, file) {
  for (const match of code.matchAll(relativeOutputs)) {
    if (/%[\da-f]{2}/i.test(match[1]) || existsSync(resolve(dirname(file), match[1]))) return true
  }
  return false
}
const cache = new WeakMap()

function lineStarts(text) {
  const lines = [0]
  for (let offset = 0; offset < text.length; offset++) if (text.charCodeAt(offset) === 10) lines.push(offset + 1)
  return lines
}

function position(lines, offset) {
  let low = 0, high = lines.length
  while (low + 1 < high) {
    const middle = (low + high) >> 1
    if (lines[middle] <= offset) low = middle
    else high = middle
  }
  return [low + 1, offset - lines[low] + 1]
}

function nodes(ast) {
  const result = [], pending = [ast]
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== "object") continue
    result.push(node)
    for (const [key, value] of Object.entries(node)) {
      if (["range", "loc", "tokens", "comments"].includes(key)) continue
      if (Array.isArray(value)) for (const child of value) pending.push(child)
      else if (value && typeof value === "object") pending.push(value)
    }
  }
  return result
}

function stringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value
  if (node?.type === "TemplateLiteral" && !node.expressions.length) return node.quasis[0]?.value.cooked
}

function moduleSource(node) {
  if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type)) return node.source
  if (node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "require") return node.arguments[0]
}

// Source extension rewriting can make a source import and a literal .js import
// identical. Restore each source import from its mapped original syntax before
// the bundler resolves it. Ordinary strings and authored .js imports keep their
// exact meaning; composing the edits retains the original source positions.
export function relativeOutput(result, file, backend, compiler, debug) {
  const { code, map } = result
  if (result.errors?.length || !map?.sourcesContent || !needsOriginalImports(code, file)) return result
  const previous = cache.get(map)
  if (previous?.code === code) return { ...result, ...previous.output }

  function parse(text, filename) {
    const [executable, args] = backend.compilerCommand(compiler(), ["--estree", filename])
    const started = Date.now()
    debug(`imports parse start: ${filename}`)
    const run = spawnSync(executable, args, { input: text, encoding: "utf8", maxBuffer: 1 << 30 })
    debug(`imports parse finish: ${filename}; status=${run.status}, ms=${Date.now() - started}`)
    if (run.error || run.status !== 0) throw new Error(`VibeLang could not read module imports in ${filename} (status ${run.status ?? run.error?.code})`)
    let parsed
    try { parsed = JSON.parse(run.stdout) } catch {
      throw new Error(`VibeLang returned invalid module-import syntax data for ${filename}`)
    }
    if (!parsed.ast) throw new Error(`VibeLang returned no module-import syntax data for ${filename}`)
    return parsed.ast
  }

  // Compiled output can preserve JSX even when the owning module is .vibe.
  const ast = parse(code, file + ".vibex")
  const sourceMap = new SourceMap(map), lines = lineStarts(code), originals = new Map(), edits = new MagicString(code)
  let count = 0
  for (const node of nodes(ast)) {
    const source = moduleSource(node), emitted = stringValue(source)
    if (typeof emitted !== "string" || !/^\.\.?\//.test(emitted) || !outputSuffix.test(emitted)) continue
    const [line, column] = position(lines, source.range[0])
    const origin = sourceMap.findOrigin(line, column)
    const index = map.sources.indexOf(origin.fileName), text = map.sourcesContent[index]
    if (typeof text !== "string") continue
    let original = originals.get(index)
    if (!original) {
      original = { lines: lineStarts(text), nodes: nodes(parse(text, map.sources[index])) }
      originals.set(index, original)
    }
    const offset = original.lines[origin.lineNumber - 1] + origin.columnNumber - 1
    const literal = original.nodes.find(candidate => candidate.range && stringValue(candidate) !== undefined && candidate.range[0] <= offset && candidate.range[1] > offset)
    const written = stringValue(literal)
    if (typeof written !== "string" || written === emitted || !/^\.\.?\//.test(written) || !sourceSuffix.test(written)) continue
    edits.overwrite(source.range[0], source.range[1], text.slice(...literal.range))
    count++
  }
  const output = count ? {
    code: edits.toString(),
    map: remapping([edits.generateMap({ file, source: file, includeContent: true, hires: true }), map], () => null)
  } : { code, map }
  debug(`imports restored: ${file}; count=${count}`)
  cache.set(map, { code, output })
  return { ...result, ...output }
}

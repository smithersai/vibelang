import { SourceMap } from "node:module"
import { fileURLToPath } from "node:url"

// Preserve the formatter present when the preload starts; Node already maps
// its default stacks. Tooling that replaces it later needs native frames.
const initialFormatter = Error.prepareStackTrace
const maps = new Map()
const mappedFrames = new WeakSet()
let formatter

function originalFrame(frame) {
  if (mappedFrames.has(frame)) return frame
  const name = frame.getFileName() ?? frame.getScriptNameOrSourceURL()
  const map = maps.get(name)
  const line = frame.getLineNumber(), column = frame.getColumnNumber()
  if (map === undefined || line === null || column === null) return frame
  const origin = map.findOrigin(line, column)
  if (origin.fileName === undefined) return frame
  const location = `${origin.fileName}:${origin.lineNumber}:${origin.columnNumber}`
  const methods = {
    getFileName: () => origin.fileName,
    getScriptNameOrSourceURL: () => origin.fileName,
    getLineNumber: () => origin.lineNumber,
    getColumnNumber: () => origin.columnNumber,
    toString: () => frame.toString().replace(`${name}:${line}:${column}`, location)
  }
  // V8 CallSite methods require their original receiver. Keep every method the
  // formatter uses, including async/constructor metadata and future additions.
  const mapped = new Proxy(frame, {
    get(target, key) {
      if (Object.hasOwn(methods, key)) return methods[key]
      const value = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    }
  })
  mappedFrames.add(mapped)
  return mapped
}

// Node maps default stacks, but custom V8 formatters receive generated frames.
// Preserve their output (including non-string results) and map native frames
// before handing them to the formatter. Other modules keep their own mapping.
export function rememberSourceMap(url, payload) {
  const map = new SourceMap(payload)
  maps.set(url, map)
  maps.set(fileURLToPath(url), map)
  const current = Error.prepareStackTrace
  if (typeof current !== "function" || current === formatter || current === initialFormatter) return
  formatter = function(error, frames) {
    return Reflect.apply(current, this, [error, frames.map(originalFrame)])
  }
  Error.prepareStackTrace = formatter
}

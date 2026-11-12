import { jsonc } from "../templates/typecheck.mjs"

const object = value => value !== null && typeof value === "object" && !Array.isArray(value)
const stringList = value => value == null || Array.isArray(value) && value.every(item => typeof item === "string")

export const prettierConfig = value => object(value) && (value.plugins == null || Array.isArray(value.plugins))
export const dprintConfigNames = ["dprint.json", ".dprint.json", "dprint.jsonc", ".dprint.jsonc"]

/** Setup and formatter discovery accept the same JSONC data and list shapes. */
export function readDprintConfig(text) {
  const config = jsonc(text)
  if (!object(config) || !["plugins", "includes", "excludes"].every(key => stringList(config[key]))) {
    throw new Error("dprint configuration must be an object with string lists")
  }
  return config
}

/**
 * Change only managed lists. Keep comments, unrelated properties, string
 * spellings, line endings and trailing commas instead of serializing the file.
 * The reader has already validated the JSONC and each managed list's shape.
 */
export function editDprintConfig(text, config, lists) {
  const tokens = [...text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)]
    .filter(match => !match[0].startsWith("//") && !match[0].startsWith("/*"))
    .map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }))
  const properties = new Map()
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].text
    if (depth === 1 && token.startsWith('"') && tokens[i + 1]?.text === ":") {
      const start = i + 2
      let end = start
      if (tokens[start].text === "[") {
        while (tokens[end].text !== "]") end++
      }
      properties.set(JSON.parse(token), { start, end })
    }
    if (token === "{" || token === "[") depth++
    else if (token === "}" || token === "]") depth--
  }
  const edits = [], missing = []
  for (const [key, values] of Object.entries(lists)) {
    if (JSON.stringify(config[key]) === JSON.stringify(values)) continue
    const property = properties.get(key)
    if (!property) { missing.push(JSON.stringify(key) + ": " + JSON.stringify(values)); continue }
    const { start, end } = property
    if (tokens[start].text !== "[") {
      edits.push({ start: tokens[start].start, end: tokens[end].end, text: JSON.stringify(values) })
      continue
    }
    const remaining = [...values]
    const elements = tokens.slice(start + 1, end).filter(token => token.text.startsWith('"'))
    const kept = elements.filter(token => {
      const value = JSON.parse(token.text)
      const index = remaining.indexOf(value)
      if (index >= 0) { remaining.splice(index, 1); return true }
      edits.push({ start: token.start, end: token.end, text: "" })
      return false
    })
    const trailing = tokens[end - 1].text === ","
    // A kept element needs a comma only before another element or when the
    // authored array has a trailing comma. Comments are never part of a removal.
    for (let i = start + 1; i < end; i++) {
      if (tokens[i].text !== ",") continue
      const previous = tokens[i - 1]
      if (!kept.includes(previous) || previous === kept.at(-1) && !trailing) {
        edits.push({ start: tokens[i].start, end: tokens[i].end, text: "" })
      }
    }
    if (remaining.length) {
      const prefix = kept.length ? trailing ? " " : ", " : ""
      edits.push({ start: tokens[end].start, end: tokens[end].start,
        text: prefix + remaining.map(value => JSON.stringify(value)).join(", ") + (trailing ? "," : "") })
    }
  }
  if (missing.length) {
    const close = tokens.at(-1)
    const previous = tokens.at(-2).text
    const newline = /\r\n|\n|\r/.exec(text)?.[0] ?? "\n"
    edits.push({ start: close.start, end: close.start,
      text: (previous === "{" || previous === "," ? "" : ",") + newline + "  " + missing.join("," + newline + "  ") + (previous === "," ? "," : "") + newline })
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  return text
}

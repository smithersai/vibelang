// VIP-23 permits a pipe after a closed block-bodied catch arrow.
// Check the class of blanket arrow-head exclusions, not a particular witness.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

export function violations(text) {
  const prose = text.replace(/^\x60\x60\x60[^]*?^\x60\x60\x60/gm, block => block.replace(/[^\n]/g, " "))
  const out = []
  for (const match of prose.matchAll(/It is a Syntax Error if[^\n]*?\.(?=\s|$)/g)) {
    const rule = match[0]
    if (!/PipeExpression/.test(rule) || !/ArrowHandler|arrow handler/.test(rule)) continue
    if (/open arrow|expression body|expression-bodied/.test(rule)) continue
    out.push({ line: text.slice(0, match.index).split("\n").length,
      message: "a pipe-head arrow restriction must distinguish an open expression body from a closed block body (VIP-23)" })
  }
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? fileURLToPath(new URL("../design/src/900-appendices.md", import.meta.url))
  const found = violations(readFileSync(file, "utf8"))
  for (const v of found) console.error(file + ":" + v.line + ": " + v.message)
  if (found.length) process.exitCode = 1
  else console.log("spec-pipe-arrows: closed arrow bodies remain admitted")
}

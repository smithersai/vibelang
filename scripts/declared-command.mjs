import assert from "node:assert/strict"
import { buildContractExclusions, buildContractSuites } from "../build-contract-inputs.ts"

// The whole command a check in PACKAGE.ts declares, with its concatenations and
// shared selections folded. A test that reads only the first string literal runs
// a truncated command as soon as the declaration joins a shared value.
export function declaredCommand(declaration, name) {
  let marker = (name === "release" ? name : JSON.stringify(name)) + ": check("
  let start = declaration.indexOf(marker)
  if (start < 0) {
    const alias = declaration.match(new RegExp(JSON.stringify(name) + ":\\s*([A-Za-z_][A-Za-z_0-9]*)\\s*,"))
    assert.ok(alias, name + " names its shared check")
    marker = "const " + alias[1] + " = check("
    start = declaration.indexOf(marker)
  }
  assert.ok(start >= 0, name + " declares its check")
  const source = declaration.slice(start + marker.length)
  const literal = /"(?:[^"\\]|\\.)*"/y
  let position = 0
  const space = () => { while (/\s/.test(source[position] ?? "")) position++ }
  const string = () => {
    space()
    literal.lastIndex = position
    const match = literal.exec(source)
    assert.ok(match, name + " uses literal command strings")
    position = literal.lastIndex
    return JSON.parse(match[0])
  }
  string() // summary
  space()
  assert.equal(source[position++], ",")
  const parts = []
  do {
    space()
    if (source.startsWith('buildContractSuites.join(" ")', position)) {
      parts.push(buildContractSuites.join(" "))
      position += 'buildContractSuites.join(" ")'.length
    } else if (source.startsWith("buildContractExclusions", position)) {
      parts.push(buildContractExclusions)
      position += "buildContractExclusions".length
    } else parts.push(string())
    space()
    if (source[position] !== "+") break
    position++
  } while (true)
  assert.equal(source[position], ",")
  return parts.join("")
}

// Oracles for the platform split's host operations (lib/platform.mjs,
// hostOperations), shared by the property tests.
import assert from "node:assert/strict"

// VIP-40: a body is a TypeScript file stored in the .vibe file. Moving it to a
// sibling and naming that file where the module wrote the body's name changes
// no observation, so runtime and declaration checks run that sibling.
export function materialize(module, file = "./x.vibe.platform.mjs", name = "platform") {
  const open = "module " + name + " {\n", start = module.indexOf(open)
  assert.ok(start >= 0, module)
  const end = module.indexOf("\n}\n", start)
  const body = module.slice(start + open.length, end + 1)
  const rest = module.slice(0, start) + module.slice(end + 3)
  return { body, module: rest.replace(new RegExp("( from )" + name + "$", "gm"), "$1" + JSON.stringify(file)) }
}

// Undo each helper the body declares: what remains must be the source text.
export function restore(module) {
  const { body, module: rest } = materialize(module)
  let text = rest
  for (const line of body.split("\n")) {
    let m
    if ((m = /^export const (\$\w+): typeof ([\w.]+) = /.exec(line))) text = text.split(m[1] + "(").join(m[2] + "(")
    else if ((m = /^export function (\$\w+)\(\) \{ return typeof (\w+) \}$/.exec(line))) text = text.split(m[1] + "()").join("typeof " + m[2])
    else if ((m = /^export function (\$\w+)\(value: typeof ([\w.]+)\) \{ return [\w.]+ = value \}$/.exec(line))) text = text.replace(new RegExp(m[1].replace("$", "\\$") + "\\(([^()]*)\\)", "g"), m[2] + " = $1")
    else if ((m = /^export function (\$\w+)\(\) \{ return ([\w.]+) \}$/.exec(line))) text = text.split(m[2] + ": " + m[1] + "()").join(m[2]).split(m[1] + "()").join(m[2])
  }
  return text
}

// The non-import lines of a module, for comparing statement text.
export const statements = (text) => text.split("\n").filter((line) => line.trim() && !/^import /.test(line))

#!/usr/bin/env node
// Gives packages/runtime the Effect packages experiments installed, as links.
//
// Each repository fixture links vibelang-runtime to packages/runtime and takes
// effect from experiments. A separate install in packages/runtime is a second
// copy beneath that link, so a declaration sidecar can name its types only as
// vibelang-runtime/node_modules/effect/..., and the compiler reports TS2883.
// A published install has neither problem: effect is the runtime's peer
// dependency, so the project and the runtime read one copy, outside the runtime.
//
//   node scripts/share-effect.mjs [root]
//
// A symlinked packages/runtime/node_modules or scope beneath it is a shared
// install its owner provisioned, so this leaves it alone. A package at another
// version stays: scripts/effect-pin.mjs reports that.
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pinned = (name) => name === "effect" || (name.startsWith("@effect/") && name !== "@effect/language-service")
const version = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version

// installed lists packages in private directories, excluding provisioned scopes.
function installed(modules) {
  return readdirSync(modules).flatMap((name) => {
    if (!name.startsWith("@")) return [name]
    const scope = path.join(modules, name)
    // Do not traverse a provisioned scope and replace packages in its owner.
    if (lstatSync(scope).isSymbolicLink()) return []
    return readdirSync(scope).map((scoped) => name + "/" + scoped)
  })
}

// share links each Effect package of packages/runtime to the copy in
// experiments and returns the names it linked.
export function share(root) {
  const from = path.join(root, "experiments/node_modules")
  const to = path.join(root, "packages/runtime/node_modules")
  if (!existsSync(from) || !existsSync(to) || lstatSync(to).isSymbolicLink()) return []
  const linked = []
  for (const name of installed(to).filter(pinned)) {
    const source = path.join(from, name), target = path.join(to, name)
    if (lstatSync(target).isSymbolicLink() || !existsSync(path.join(source, "package.json"))) continue
    if (version(source) !== version(target)) continue
    rmSync(target, { recursive: true })
    symlinkSync(path.relative(path.dirname(target), source), target)
    linked.push(name)
  }
  return linked
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  share(path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..")))
}

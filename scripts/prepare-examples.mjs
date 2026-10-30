// Stage example sources for repository checks without changing their published pins.
import { cpSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function prepareExample(source, destination, packages, effect) {
  cpSync(source, destination, {
    recursive: true,
    filter: path => !["node_modules", "dist", ".prototype", ".vibe", "bun.lock", "package-lock.json"].includes(basename(path))
  })
  const path = join(destination, "package.json")
  const manifest = JSON.parse(readFileSync(path, "utf8"))
  const localPackages = Object.fromEntries(Object.entries(packages).map(([name, target]) => [name, "file:" + resolve(target)]))
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, target] of Object.entries(localPackages)) {
      if (manifest[section]?.[name]) manifest[section][name] = target
    }
  }
  manifest.overrides = { ...manifest.overrides, ...localPackages, "@effect/platform-node-shared": effect }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repository, destination, runtime] = process.argv.slice(2)
  if (!repository || !destination || !runtime) throw new Error("usage: prepare-examples.mjs <repository> <destination> <runtime.tgz>")
  const effect = JSON.parse(readFileSync(join(repository, "packages/runtime/package.json"), "utf8")).peerDependencies.effect
  const packages = {
    vibelang: join(repository, "packages/compiler"),
    "vibelang-runtime": runtime,
    "vibelang-vite": join(repository, "packages/vite")
  }
  for (const entry of readdirSync(join(repository, "examples"), { withFileTypes: true })) {
    if (entry.isDirectory()) prepareExample(join(repository, "examples", entry.name), join(destination, entry.name), packages, effect)
  }
}

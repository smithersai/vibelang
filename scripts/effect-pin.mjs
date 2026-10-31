#!/usr/bin/env node
// The repository's Effect pin: one version, read from vibelang-runtime's
// peerDependencies, that every manifest naming effect or an @effect/* package
// pins exactly, and that the runtime's and the compiler's version literals
// (SOURCES) name.
//
//   node scripts/effect-pin.mjs                    list every pin that differs; exit 1 if any does
//   node scripts/effect-pin.mjs --write            rewrite every differing pin to the runtime's
//   node scripts/effect-pin.mjs --write 4.2.0      move the runtime's pin to 4.2.0, then rewrite the rest
//
// --write edits only the pin strings, so each manifest keeps its formatting,
// and prints the directories whose lockfile now needs an install. Moving the
// pin also takes regenerated tables and docs: docs/maintainers/effect-upgrade.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const RUNTIME = "packages/runtime/package.json"
// The source literals that state the pin, each with the pattern that finds it.
export const SOURCES = [
  ["packages/runtime/src/version.ts", /^(export const PINNED_EFFECT_VERSION = ")([^"]*)(")$/m],
  ["packages/runtime/src/version-guard.cts", /^(const PINNED_EFFECT_VERSION = ")([^"]*)(")$/m],
  ["typescript/tsc/internal/vibelang/effectavailable.go", /^(const supportedEffectVersion = ")([^"]*)(")$/m]
]
const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"]
// Installs, version control and run outputs: no tracked manifest lives under these.
const SKIP = new Set(["node_modules", ".jj", ".git", ".flows", ".cache", "dist", "out"])
const LOCKFILES = ["bun.lock", "package-lock.json", "pnpm-lock.yaml"]

// Manifests that install Effect for a tool of their own, not for code VibeLang
// compiles; their tool decides their version.
export const EXEMPT = new Map([
  [".smithers/package.json", "the Smithers packages' own Effect"],
  ["site/package.json", "the site's Cloudflare deploy (alchemy)"]
])

// Whether name versions with effect: effect itself and the @effect/* packages
// released from Effect's repository with it.
export const pinned = (name) => name === "effect" || (name.startsWith("@effect/") && name !== "@effect/language-service")

// manifests lists every package.json under root, as paths relative to it.
export function manifests(root, dir = "") {
  const out = []
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".smthrs")) continue
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...manifests(root, rel))
    else if (entry.isFile() && entry.name === "package.json") out.push(rel)
  }
  return out.sort()
}

// runtimePin is the version the runtime asks its users for.
export function runtimePin(root) {
  const pin = JSON.parse(readFileSync(path.join(root, RUNTIME), "utf8")).peerDependencies?.effect
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(pin ?? "")) throw new Error(`${RUNTIME}: peerDependencies.effect is ${JSON.stringify(pin)}, not an exact version`)
  return pin
}

// drift lists every pin under root that differs from version: { file, section, name, pin }.
export function drift(root, version = runtimePin(root)) {
  const out = []
  for (const file of manifests(root)) {
    if (EXEMPT.has(file)) continue
    let manifest
    try {
      manifest = JSON.parse(readFileSync(path.join(root, file), "utf8"))
    } catch {
      continue // a fixture that is not JSON on purpose
    }
    for (const section of SECTIONS) {
      for (const [name, pin] of Object.entries(manifest[section] ?? {})) {
        if (pinned(name) && typeof pin === "string" && pin !== version) out.push({ file, section, name, pin })
      }
    }
  }
  for (const [file, pattern] of SOURCES) {
    if (!existsSync(path.join(root, file))) continue
    const m = pattern.exec(readFileSync(path.join(root, file), "utf8"))
    if (!m || m[2] !== version) out.push({ file, section: "source", name: "literal", pin: m ? m[2] : "(missing)" })
  }
  return out
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")

// rewrite sets each of names' string pins in a manifest's text to version and
// checks that nothing else changed.
export function rewrite(text, names, version) {
  let out = text
  for (const name of names) {
    out = out.replace(new RegExp(`("${escape(name)}"\\s*:\\s*")[^"]*(")`, "g"), `$1${version}$2`)
  }
  const before = JSON.parse(text), after = JSON.parse(out)
  for (const section of SECTIONS) {
    for (const [name, pin] of Object.entries(before[section] ?? {})) {
      if (names.includes(name) && typeof pin === "string") before[section][name] = version
    }
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`rewriting ${names.join(", ")} would change more than their pins`)
  return out
}

// write moves every pin under root to version (default: the runtime's) and
// returns the files it changed and the directories whose lockfile needs an install.
export function write(root, version) {
  const target = version ?? runtimePin(root)
  if (version !== undefined && !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) throw new Error(`${version} is not an exact version`)
  const byFile = new Map()
  for (const d of drift(root, target)) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d.name])
  const changed = [], installs = []
  for (const [file, names] of byFile) {
    const at = path.join(root, file)
    const text = readFileSync(at, "utf8")
    const source = SOURCES.find(([name]) => name === file)
    const next = source ? text.replace(source[1], `$1${target}$3`) : rewrite(text, [...new Set(names)], target)
    if (next === text) continue
    writeFileSync(at, next)
    changed.push(file)
    const dir = path.dirname(file)
    if (LOCKFILES.some((lock) => existsSync(path.join(root, dir, lock)))) installs.push(dir)
  }
  return { version: target, changed, installs }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const args = process.argv.slice(2)
  if (args[0] === "--write") {
    const { version, changed, installs } = write(root, args[1])
    console.log(`effect-pin: ${changed.length} files now pin effect ${version}`)
    for (const dir of installs) console.log(`effect-pin: reinstall ${dir} (its lockfile pins the old version)`)
  } else if (args.length === 0) {
    const version = runtimePin(root)
    const found = drift(root, version)
    for (const d of found) console.error(`${d.file}: ${d.section} ${d.name} is ${d.pin}, not ${version}`)
    if (found.length) {
      console.error(`effect-pin: ${found.length} pins differ from ${RUNTIME}'s effect ${version}; run: node scripts/effect-pin.mjs --write`)
      process.exit(1)
    }
    console.log(`effect-pin: every manifest pins effect ${version}`)
  } else {
    console.error("usage: node scripts/effect-pin.mjs [--write [version]]")
    process.exit(2)
  }
}

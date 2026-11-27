#!/usr/bin/env node
import { isMain } from "./is-main.mjs"
// The repository's Effect versions:
// - Published peer range (peerDependencies.effect on vibelang-runtime, vibelang,
//   and vibelang-ts-mapper): a stable semver caret range (currently "^4.1.0").
// - Repo tested Effect baseline (devDependencies.effect on vibelang-runtime):
//   an exact version (currently "4.1.6") that every internal manifest,
//   example, template, and compiler case pins, and that the runtime's and
//   compiler's version literals (SOURCES) name.
//
//   node scripts/effect-pin.mjs                    list every pin that differs; exit 1 if any does
//   node scripts/effect-pin.mjs --write            rewrite every differing pin to the runtime's
//   node scripts/effect-pin.mjs --write 4.2.0      move the runtime's baseline to 4.2.0, then rewrite the rest
//
// --write edits only the pin strings, so each manifest keeps its formatting,
// and prints the directories whose lockfile now needs an install. Moving the
// baseline also takes regenerated tables and docs: docs/maintainers/effect-upgrade.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const RUNTIME = "packages/runtime/package.json"
// Published packages whose peerDependencies declare the supported Effect semver range.
export const PEER_MANIFESTS = new Set([
  "packages/runtime/package.json",
  "packages/compiler/package.json",
  "packages/ts-mapper/package.json"
])
// The source literals that state the tested baseline version, each with the pattern that finds it.
export const SOURCES = [
  ["packages/runtime/src/version.ts", /^(export const PINNED_EFFECT_VERSION = ")([^"]*)(")$/m],
  ["packages/runtime/src/version-guard.cts", /^(const PINNED_EFFECT_VERSION = ")([^"]*)(")$/m],
  ["typescript/tsc/internal/vibelang/effectavailable.go", /^(const supportedEffectVersion = ")([^"]*)(")$/m]
]
// The source literals that state the supported semver range, each with the pattern that finds it.
export const RANGE_SOURCES = [
  ["packages/runtime/src/version.ts", /^(export const SUPPORTED_EFFECT_RANGE = ")([^"]*)(")$/m],
  ["packages/runtime/src/version-guard.cts", /^(const SUPPORTED_EFFECT_RANGE = ")([^"]*)(")$/m],
  ["typescript/tsc/internal/vibelang/effectavailable.go", /^(const supportedEffectRange = ")([^"]*)(")$/m]
]
const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"]
// Installs, version control and run outputs: no tracked manifest lives under these.
const SKIP = new Set(["node_modules", ".jj", ".git", ".flows", ".cache", ".fixtures", ".prepared", "dist", "out"])
const LOCKFILES = ["bun.lock", "package-lock.json", "pnpm-lock.yaml"]

// Manifests that install Effect for a tool of their own, not for code VibeLang
// compiles; their tool decides their version.
export const EXEMPT = new Map([
  [".smithers/package.json", "the Smithers packages' own Effect"],
  ["site/package.json", "the site's Cloudflare deploy (alchemy)"],
  [".smithers/flows/migrate/fixture/canonical/package.json", "the migrate eval's target, which starts on its own older Effect"]
])

// @effect/* packages that version independently from Effect core.
export const UNPINNED_EFFECT_PACKAGES = new Set([
  "@effect/language-service",
  "@effect/ui",
  "@effect/ui-kit",
  "@effect/ui-devtools",
  "@effect/ui-opentui"
])

// Whether name versions with effect: effect itself and the @effect/* packages
// released from Effect's repository with it.
export const pinned = (name) =>
  name === "effect" || (name.startsWith("@effect/") && !UNPINNED_EFFECT_PACKAGES.has(name))

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/
const PEER_RANGE = /^\^\d+\.\d+\.\d+$/

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

// runtimePin is the exact tested Effect baseline version for the repository.
export function runtimePin(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, RUNTIME), "utf8"))
  const pin = manifest.devDependencies?.effect ?? manifest.peerDependencies?.effect
  if (!EXACT_VERSION.test(pin ?? "")) throw new Error(`${RUNTIME}: devDependencies.effect is ${JSON.stringify(pin)}, not an exact version`)
  return pin
}

// runtimePeerRange is the Effect semver range published packages ask users for.
export function runtimePeerRange(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, RUNTIME), "utf8"))
  const peer = manifest.peerDependencies?.effect
  if (PEER_RANGE.test(peer ?? "") || EXACT_VERSION.test(peer ?? "")) return peer
  throw new Error(`${RUNTIME}: peerDependencies.effect is ${JSON.stringify(peer)}, not a supported version or ^range`)
}

function expectedPin(file, section, version, peerRange) {
  if (section === "peerDependencies" && PEER_MANIFESTS.has(file)) return peerRange
  return version
}

// drift lists every pin under root that differs from version/peerRange: { file, section, name, pin, expected }.
export function drift(root, version = runtimePin(root), peerRange = runtimePeerRange(root)) {
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
      const target = expectedPin(file, section, version, peerRange)
      for (const [name, pin] of Object.entries(manifest[section] ?? {})) {
        if (pinned(name) && typeof pin === "string" && pin !== target) {
          out.push({ file, section, name, pin, expected: target })
        }
      }
    }
  }
  for (const [file, pattern] of SOURCES) {
    if (!existsSync(path.join(root, file))) continue
    const m = pattern.exec(readFileSync(path.join(root, file), "utf8"))
    if (!m || m[2] !== version) out.push({ file, section: "source", name: "literal", pin: m ? m[2] : "(missing)", expected: version })
  }
  if (PEER_RANGE.test(peerRange)) {
    for (const [file, pattern] of RANGE_SOURCES) {
      if (!existsSync(path.join(root, file))) continue
      const m = pattern.exec(readFileSync(path.join(root, file), "utf8"))
      if (!m || m[2] !== peerRange) out.push({ file, section: "source-range", name: "range", pin: m ? m[2] : "(missing)", expected: peerRange })
    }
  }
  return out
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")

// findObjectRange finds the [openBrace, closeBrace] span of a top-level JSON object key.
function findObjectRange(text, key) {
  let depth = 0
  let inString = false
  let escaped = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === "\"") inString = false
      i++
      continue
    }
    if (ch === "\"") {
      if (depth === 1) {
        const start = i
        i++
        let str = ""
        let esc = false
        while (i < text.length) {
          const c = text[i]
          if (esc) { str += c; esc = false }
          else if (c === "\\") { esc = true }
          else if (c === "\"") break
          else str += c
          i++
        }
        i++ // past closing quote
        while (i < text.length && /\s/.test(text[i])) i++
        if (text[i] === ":" && str === key) {
          i++
          while (i < text.length && /\s/.test(text[i])) i++
          if (text[i] === "{") {
            const open = i
            let objDepth = 0
            let s = false
            let e = false
            while (i < text.length) {
              const c = text[i]
              if (s) {
                if (e) e = false
                else if (c === "\\") e = true
                else if (c === "\"") s = false
              } else {
                if (c === "\"") s = true
                else if (c === "{") objDepth++
                else if (c === "}") {
                  objDepth--
                  if (objDepth === 0) return [open, i]
                }
              }
              i++
            }
            return null
          }
        }
        void start
        continue
      }
      inString = true
      i++
      continue
    }
    if (ch === "{") depth++
    else if (ch === "}") depth--
    i++
  }
  return null
}

// rewrite sets each of names' string pins in a manifest's text to version and
// checks that nothing else changed. When updates is an array of { section, name, expected },
// each section is updated independently so peerDependencies can keep a range while
// devDependencies holds an exact version.
export function rewrite(text, namesOrUpdates, version) {
  const updates = Array.isArray(namesOrUpdates) && typeof namesOrUpdates[0] === "string"
    ? SECTIONS.flatMap((section) => namesOrUpdates.map((name) => ({ section, name, expected: version })))
    : namesOrUpdates
  let out = text
  const bySection = new Map()
  for (const u of updates) {
    if (!bySection.has(u.section)) bySection.set(u.section, [])
    bySection.get(u.section).push(u)
  }
  for (const [section, list] of bySection) {
    const range = findObjectRange(out, section)
    if (!range) continue
    const [open, close] = range
    let body = out.slice(open, close + 1)
    for (const { name, expected } of list) {
      body = body.replace(new RegExp(`("${escape(name)}"\\s*:\\s*")[^"]*(")`, "g"), `$1${expected}$2`)
    }
    out = out.slice(0, open) + body + out.slice(close + 1)
  }
  const before = JSON.parse(text), after = JSON.parse(out)
  for (const { section, name, expected } of updates) {
    if (typeof before[section]?.[name] === "string") before[section][name] = expected
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`rewriting ${updates.map((u) => `${u.section}.${u.name}`).join(", ")} would change more than their pins`)
  }
  return out
}

// write moves every pin under root to version (default: the runtime's baseline)
// and returns the files it changed and the directories whose lockfile needs an install.
export function write(root, version) {
  const target = version ?? runtimePin(root)
  if (version !== undefined && !EXACT_VERSION.test(version)) throw new Error(`${version} is not an exact version`)
  const peerRange = runtimePeerRange(root)
  const targetPeerRange = version !== undefined && EXACT_VERSION.test(peerRange) ? target : peerRange
  const byFile = new Map()
  for (const d of drift(root, target, targetPeerRange)) {
    if ((d.section === "source" || d.section === "source-range") && d.pin === "(missing)") {
      throw new Error(`${d.file}: missing Effect version literal`)
    }
    byFile.set(d.file, [...(byFile.get(d.file) ?? []), d])
  }
  const changed = [], installs = []
  for (const [file, items] of byFile) {
    const at = path.join(root, file)
    const text = readFileSync(at, "utf8")
    let next = text
    const source = SOURCES.find(([name]) => name === file)
    const rangeSource = RANGE_SOURCES.find(([name]) => name === file)
    if (source || rangeSource) {
      for (const item of items) {
        if (item.section === "source" && source) next = next.replace(source[1], `$1${item.expected}$3`)
        if (item.section === "source-range" && rangeSource) next = next.replace(rangeSource[1], `$1${item.expected}$3`)
      }
    } else {
      next = rewrite(text, items)
    }
    if (next === text) continue
    writeFileSync(at, next)
    changed.push(file)
    const dir = path.dirname(file)
    if (LOCKFILES.some((lock) => existsSync(path.join(root, dir, lock)))) installs.push(dir)
  }
  return { version: target, changed, installs }
}

if (isMain(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const args = process.argv.slice(2)
  if (args[0] === "--write") {
    const { version, changed, installs } = write(root, args[1])
    const peerRange = runtimePeerRange(root)
    console.log(`effect-pin: ${changed.length} files now align with effect baseline ${version} (peer ${peerRange})`)
    for (const dir of installs) console.log(`effect-pin: reinstall ${dir} (its lockfile pins the old version)`)
  } else if (args.length === 0) {
    const version = runtimePin(root)
    const peerRange = runtimePeerRange(root)
    const found = drift(root, version, peerRange)
    for (const d of found) console.error(`${d.file}: ${d.section} ${d.name} is ${d.pin}, not ${d.expected}`)
    if (found.length) {
      console.error(`effect-pin: ${found.length} pins differ from ${RUNTIME} (baseline ${version}, peer ${peerRange}); run: node scripts/effect-pin.mjs --write`)
      process.exit(1)
    }
    console.log(`effect-pin: every manifest aligns with effect baseline ${version} (peer ${peerRange})`)
  } else {
    console.error("usage: node scripts/effect-pin.mjs [--write [version]]")
    process.exit(2)
  }
}

// The literals step's rule: a tracked text file that writes the old pin, such
// as `effect@4.1.0` in an install doc or `"4.1.0"` in a test, states the
// current version and moves with it. The 4.1.1 bump (lane effect411-vibelang,
// on main 61878b40) changed 839 of the 858 tracked files that wrote 4.1.0,
// 159 of them only in that literal; EXEMPT names the other 19 and why.
import { spawnSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const GUARD = "a pin guard: its witnesses are the versions around the pin"

// [glob, why the file keeps the old version]. A glob as the shell and smthrs
// read one: `**` crosses directories, `*` does not.
export const EXEMPT = [
  ["**/package.json", "scripts/effect-pin.mjs moves effect and @effect/* by name, and stubVersion a stub's own version; another package at the same version stays"],
  ["**/bun.lock", "the install step rewrites a lockfile"],
  ["**/package-lock.json", "the install step rewrites a lockfile"],
  [".smithers/flows/effect-bump/**", "the flow's eval names the versions it moves between"],
  [".smithers/flows/migrate/test/**", "migration fixtures keep the versions their repositories had"],
  ["packages/runtime/tests/package.test.ts", GUARD],
  ["scripts/effect-pin.test.mjs", GUARD],
  ["typescript/tsc/internal/vibelang/effect_pin_test.go", GUARD],
  ["typescript/tsc/internal/vibelang/testdata/effect-pin/**", GUARD],
  ["typescript/tsc/internal/vibelangfuzz/effect_pin_fuzz_test.go", GUARD],
  ["scripts/deploy-docs.test.mjs", "a fixture manifest whose version is arbitrary"],
  ["docs/tools/published-site-unit.test.mjs", "a fixture manifest whose version is arbitrary"]
]

const matcher = (glob) =>
  new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\0").replace(/\*\*/g, "\x01").replace(/\*/g, "[^/]*")
    .replace(/\0/g, "(?:.*/)?").replace(/\x01/g, ".*") + "$")
const exempt = EXEMPT.map(([glob, why]) => [matcher(glob), glob, why])

/** exemption returns the glob that keeps file at the old version, or undefined. */
export const exemption = (file) => exempt.find(([re]) => re.test(file))?.[1]

/** guard reports whether glob names a pin guard, whose witnesses a person moves. */
export const guard = (glob) => EXEMPT.some(([g, why]) => g === glob && why === GUARD)

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// literal matches version as a whole version: not 14.1.0, 4.1.0.1 or 4.1.0-next.1,
// but `effect@4.1.0`, `"4.1.0"` and a sentence's final `4.1.0.`.
export const literal = (version) => new RegExp(`(?<![\\d.])${escape(version)}(?![\\w]|\\.\\d|-[0-9A-Za-z])`, "g")

/** rewrite returns text with each whole from written to. */
export const rewrite = (text, from, to) => text.replace(literal(from), to)

/** tracked lists the files under version control in repo: jj's, else git's. */
export function tracked(repo) {
  for (const [bin, args] of [["jj", ["file", "list", "--ignore-working-copy"]], ["git", ["ls-files", "-z"]]]) {
    const p = spawnSync(bin, args, { cwd: repo, encoding: "utf8", maxBuffer: 64 << 20 })
    if (p.status === 0) return p.stdout.split(bin === "git" ? "\0" : "\n").filter(Boolean)
  }
  throw new Error(`${repo}: neither jj nor git lists its files`)
}

const MAX_BYTES = 16 << 20

// A stub of effect or an @effect/* package, as compiler cases write under
// stubs/, versions with the pin: `{"name": "@effect/platform-node", "version": "4.1.0"}`.
const pinnedName = (name) => name === "effect" || (typeof name === "string" && name.startsWith("@effect/") && name !== "@effect/language-service")

/** stubVersion returns text with a pinned package's own version moved from from to to, or undefined when it has none. */
export function stubVersion(text, from, to) {
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!pinnedName(manifest?.name) || manifest.version !== from) return undefined
  const out = text.replace(new RegExp(`("version"\\s*:\\s*")${escape(from)}(")`), `$1${to}$2`)
  if (JSON.stringify({ ...manifest, version: to }) !== JSON.stringify(JSON.parse(out))) throw new Error(`moving the stub version would change more than it`)
  return out
}

/** literals rewrites from to to in files under repo, except EXEMPT and binary files; returns what changed and why the rest stayed. */
export function literals(repo, from, to, files = tracked(repo)) {
  const changed = [], kept = []
  const re = literal(from)
  for (const file of files) {
    const at = path.join(repo, file)
    let text
    try {
      if (statSync(at).size > MAX_BYTES) continue
      text = readFileSync(at, "utf8")
    } catch {
      continue // a tracked file the working copy deleted, or a directory
    }
    re.lastIndex = 0
    if (text.includes("\0") || !re.test(text)) continue
    const glob = exemption(file)
    const stub = file.endsWith("package.json") ? stubVersion(text, from, to) : undefined
    if (stub !== undefined) {
      writeFileSync(at, stub)
      changed.push(file)
      continue
    }
    if (glob) {
      kept.push({ file, glob })
      continue
    }
    writeFileSync(at, rewrite(text, from, to))
    changed.push(file)
  }
  return { changed, kept }
}

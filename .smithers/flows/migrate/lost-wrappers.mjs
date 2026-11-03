#!/usr/bin/env node
// The lost-wrapper check on two trees, outside a run: lib/lost-wrapper.mjs is verify's gate.
//   node lost-wrappers.mjs --orig <tree of .ts> --conv <tree of .vibe> [--js <emitted root>] [--ts <dir with typescript>] [--allow <file>] [--json <out>]
// A module's JavaScript is <js>/<module path>.js, or without --js under its nearest package's .vibelang/js.
// Exit 1 on a flag or a module it cannot read. A .vibe with no .ts in --orig is a new module, listed and not compared.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"
import { loadTypeScript } from "./lib/declarations.mjs"
import { lostWrapperCheck, readAllowList } from "./lib/lost-wrapper.mjs"

const { values: o } = parseArgs({ options: { orig: { type: "string" }, conv: { type: "string" }, js: { type: "string" }, ts: { type: "string" }, allow: { type: "string" }, json: { type: "string" } } })
if (!o.orig || !o.conv) { console.error("usage: --orig <tree> --conv <tree> [--js <root>] [--ts <dir>] [--allow <file>] [--json <out>]"); process.exit(2) }
const ts = loadTypeScript([o.ts, o.conv, process.cwd()].filter(Boolean).map(dir => resolve(dir)))
const skip = new Set(["node_modules", ".jj", ".git", "dist", ".vibelang", ".vibelang-toolchain"])
const walk = (dir, found = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else if (/\.vibex?$/.test(entry.name)) found.push(relative(o.conv, path))
  }
  return found
}
const originalPath = file => [".ts", ".tsx"].map(extension => file.replace(/\.vibex?$/, extension)).find(path => existsSync(join(o.orig, path)))
const emittedPath = file => {
  if (o.js) return join(o.js, file.replace(/\.vibex$/, ".jsx").replace(/\.vibe$/, ".js"))
  let dir = dirname(file)
  while (dir !== "." && !existsSync(join(o.conv, dir, "package.json"))) dir = dirname(dir)
  return join(o.conv, dir, ".vibelang/js", relative(dir, file).replace(/\.vibex$/, ".jsx").replace(/\.vibe$/, ".js"))
}
const all = walk(o.conv), files = all.filter(originalPath)
const result = lostWrapperCheck({
  ts, files, allow: o.allow ? readAllowList(o.allow) : undefined,
  original: file => ({ path: originalPath(file), text: readFileSync(join(o.orig, originalPath(file)), "utf8") }),
  emitted: file => existsSync(emittedPath(file)) ? { path: emittedPath(file), text: readFileSync(emittedPath(file), "utf8") } : null
})
for (const f of result.flags) console.log(`FLAG ${f.cast ? "CAST " : ""}${f.file}:${f.line} ${f.function} Effect returns ${f.effectReturns} -> ${f.emittedEffectReturns}`)
for (const f of result.allowed) console.log(`ALLOWED ${f.file}:${f.line} ${f.function}: ${f.reason}`)
for (const e of result.excused) console.log(`EXCUSED ${e.file}: ${e.allowedBecause}`)
for (const u of result.unchecked) console.log(`UNCHECKED ${u.file}: ${u.reason}`)
for (const u of result.unpaired) console.log(`UNPAIRED ${u.file}:${u.line} ${u.function}: returned Effect ${u.effectReturns}x, no emitted function by that path; read it`)
const newModules = all.length - files.length
console.log(`lost-wrappers: modules ${result.modules}, functions paired ${result.paired}, flagged ${result.flags.length}, allowed ${result.allowed.length}, unpaired ${result.unpaired.length}, unchecked ${result.unchecked.length}, new modules ${newModules}`)
if (o.json) writeFileSync(o.json, JSON.stringify(result, null, 1))
process.exit(result.blocking.length || result.unchecked.length ? 1 : 0)

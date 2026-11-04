#!/usr/bin/env node
// The hook census describes implementation coverage, never admission authority.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { sourcePath, outputs, marker, start, end, censusSection } from "./grammar-census.mjs"
export { sourcePath, outputs, censusSection, isGeneratedCensusSection } from "./grammar-census.mjs"
const read = (root, path) => readFileSync(join(root, path), "utf8")

// A census reason that cites a denied VIP states the denial, so the
// specification authority rule (docs/tools/spec-rules.mjs) accepts the
// generated Appendix A census. Test: scripts/grammar-admission.test.mjs.
export function deniedVips(root) {
  const dir = "docs/design/vips"
  const denied = new Set()
  for (const name of readdirSync(join(root, dir))) {
    if (!/^\d{4}.*\.md$/.test(name)) continue
    const status = read(root, join(dir, name)).match(/\*\*Status:\*\*\s*(accepted|denied|open)\b/i)?.[1]?.toLowerCase()
    if (!status) throw new Error(dir + "/" + name + ": missing VIP status")
    if (status === "denied") denied.add(Number(name.slice(0, 4)))
  }
  return denied
}

export function loadRows(root) {
  const denied = deniedVips(root)
  const seen = new Set()
  const rows = []
  for (const [i, line] of read(root, sourcePath).split("\n").entries()) {
    if (!line || line.startsWith("#")) continue
    const fields = line.split("\t")
    const [hook, form, authority, status, reason] = fields
    const fail = message => { throw new Error(`${sourcePath}:${i + 1}: ${message}`) }
    if (fields.length !== 5 || fields.some(field => !field || field.includes("\r")))
      fail("expected hook, form, authority, status, reason")
    if (!/^(parser|vibelang)\/[\w]+\.go:[\w.]+(?:@[\w.-]+)?$/.test(hook)) fail("invalid hook")
    if (seen.has(hook)) fail("duplicate hook " + hook)
    seen.add(hook)
    if (!/^admission:[\w.-]+$/.test(form)) fail("invalid form")
    if (authority === "-") {
      if (status !== "pending") fail("a row without authority must be pending")
    } else {
      if (!["admitted", "support", "recovery"].includes(status)) fail("invalid status")
      if (!authority.split(",").every(ref => /^[\w-]+\.md(?:#[\w-]+)?$/.test(ref.trim())))
        fail("invalid specification authority")
    }
    for (const cited of reason.matchAll(/\bVIP-(\d+)\b/g))
      if (denied.has(Number(cited[1])) && !/\bdenied\b/i.test(reason))
        fail("reason cites denied VIP-" + cited[1] + " without stating the denial; write \"Denied by VIP-" + cited[1] + "; ...\"")
    rows.push({ hook, form, authority, status, reason })
  }
  if (!rows.length) throw new Error("empty grammar admission source")
  return rows
}

export function render(root, rows = loadRows(root)) {
  const inventory = "# " + marker + "\n" +
    "# Hook (receiver-qualified method)\tForm\tAuthority (docs/design/src; - means none)\tStatus\tReason\n" +
    rows.map(row => Object.values(row).join("\t")).join("\n") + "\n"
  const section = censusSection(rows)
  let appendix = read(root, outputs[1])
  if (appendix.includes(start)) {
    const a = appendix.indexOf(start), b = appendix.indexOf(end, a)
    if (b < 0) throw new Error("missing " + end)
    appendix = appendix.slice(0, a) + section + appendix.slice(b + end.length)
  } else {
    const boundary = "## Appendix B. Diagnostics\n"
    if (!appendix.includes(boundary)) throw new Error("missing Appendix B boundary")
    appendix = appendix.replace(boundary, section + "\n\n" + boundary)
  }
  return { [outputs[0]]: inventory, [outputs[1]]: appendix }
}

export function generate(root, { check = false } = {}) {
  const rendered = render(root)
  const scratch = resolve(root, process.env.LANG_TABLES_TMP ?? ".cache/language-tables")
  mkdirSync(scratch, { recursive: true })
  const temp = check ? mkdtempSync(join(scratch, "grammar-admission-")) : root
  try {
    const stale = []
    for (const [path, text] of Object.entries(rendered)) {
      const destination = join(temp, path)
      mkdirSync(dirname(destination), { recursive: true })
      if (!existsSync(destination) || readFileSync(destination, "utf8") !== text) writeFileSync(destination, text)
      if (check && (!existsSync(join(root, path)) || read(root, path) !== read(temp, path))) stale.push(path)
    }
    return stale
  } finally { if (check) rmSync(temp, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--root")
  const root = resolve(at < 0 ? fileURLToPath(new URL("../", import.meta.url)) : process.argv[at + 1])
  const stale = generate(root, { check: process.argv.includes("--check") })
  for (const path of stale) console.error(`stale ${path}; run node scripts/generate-grammar-admission.mjs`)
  if (stale.length) process.exitCode = 1
}

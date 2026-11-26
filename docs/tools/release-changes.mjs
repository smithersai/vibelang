#!/usr/bin/env node
// Unreleased release-note entries live one per file in docs/user/changes/, so
// fixes that land together add separate files instead of editing one shared
// list. readReleaseNotes returns the notes as published: release-notes.md with
// each entry placed in the top release. At release, `--fold` writes the entries
// into release-notes.md and removes their files.
//
//   node docs/tools/release-changes.mjs --check | --check-empty | --fold
import { assertReleasePublication } from "./release-publication-checks.mjs"
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const notesPath = "docs/user/src/setup/release-notes.md"
export const changesDir = "docs/user/changes"
const repository = fileURLToPath(new URL("../../", import.meta.url))
const fileName = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.upgrade)?\.md$/

// A fix entry is one paragraph of plain sentences, written without the bullet.
// An upgrade entry is one or more rows of the top release's upgrade table.
export function parseChange(name, text) {
  const where = changesDir + "/" + name
  if (!fileName.test(name)) throw new Error(where + ": name a change file in lowercase kebab case, such as vite-bare-imports.md or vite-bare-imports.upgrade.md")
  const body = text.trim()
  if (!body) throw new Error(where + ": the file is empty; write the symptom a user saw, then what happens now")
  if (name.endsWith(".upgrade.md")) {
    const rows = body.split("\n").map(line => line.trim())
    for (const row of rows) {
      if (!/^\|\s*\S(?:\\\||[^|])*?\s*\|\s*\S(?:\\\||[^|])*?\s*\|$/.test(row) || /^\|[\s|:-]+\|$/.test(row) || /^\|\s*Before\s*\|/i.test(row)) throw new Error(where + ": write only rows of the upgrade table, such as | Before | After and repair |, without its header")
    }
    return { name, kind: "upgrade", text: rows.join("\n") }
  }
  if (/^(?:[-*+] |#|\||>|<!--)/.test(body)) throw new Error(where + ": write the entry as plain sentences; the release notes add the bullet")
  if (/\n\s*\n/.test(body)) throw new Error(where + ": write one paragraph; each fix is one release-note entry")
  return { name, kind: "fix", text: body.replace(/\s*\n\s*/g, " ") }
}

export function readChanges(root = repository) {
  const directory = join(root, changesDir)
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .map(entry => {
      if (!entry.isFile()) throw new Error(changesDir + "/" + entry.name + ": expected a regular file")
      return entry.name
    })
    .filter(name => name !== "README.md")
    .sort()
    .map(name => parseChange(name, readFileSync(join(directory, name), "utf8")))
}

// Fix entries end the top release's "Bugs fixed since" list and upgrade rows
// end its upgrade table, in file-name order.
export function assembleReleaseNotes(notes, changes) {
  if (changes.length === 0) return notes
  changes = [...changes].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  const start = notes.search(/^## /m)
  if (start < 0) throw new Error(notesPath + ": no release section to add " + changesDir + " entries to")
  if (!/^## \d+\.\d+\.\d+ \(unreleased\)$/m.test(notes.slice(start).split("\n")[0])) throw new Error(notesPath + ": change entries require an unreleased top section")
  const following = notes.slice(start + 1).search(/^## /m)
  const end = following < 0 ? notes.length : start + 1 + following
  let release = notes.slice(start, end)
  const subsection = heading => {
    const match = heading.exec(release)
    if (!match) return undefined
    const bodyStart = match.index + match[0].length
    const next = release.slice(bodyStart).search(/^### /m)
    return { bodyStart, bodyEnd: next < 0 ? release.length : bodyStart + next }
  }
  const fixes = changes.filter(change => change.kind === "fix")
  if (fixes.length) {
    const list = subsection(/^### Bugs fixed since .+$/m)
    if (!list) throw new Error(notesPath + ": the top release has no `### Bugs fixed since` list for " + fixes.map(change => changesDir + "/" + change.name).join(", "))
    const body = release.slice(list.bodyStart, list.bodyEnd).trimEnd()
    release = release.slice(0, list.bodyStart) + body + "\n\n" + fixes.map(change => "- " + change.text).join("\n\n") + "\n\n" + release.slice(list.bodyEnd)
  }
  const upgrades = changes.filter(change => change.kind === "upgrade")
  if (upgrades.length) {
    const table = subsection(/^### Upgrade from .+$/m)
    const body = table && release.slice(table.bodyStart, table.bodyEnd)
    const lastRow = body ? [...body.matchAll(/^\|.*\|[ \t]*$/gm)].at(-1) : undefined
    if (!lastRow) throw new Error(notesPath + ": the top release has no `### Upgrade from` table for " + upgrades.map(change => changesDir + "/" + change.name).join(", ") + "; add the heading and the table header first")
    const at = table.bodyStart + lastRow.index + lastRow[0].length
    release = release.slice(0, at) + "\n" + upgrades.map(change => change.text).join("\n") + release.slice(at)
  }
  const assembled = notes.slice(0, start) + release + notes.slice(end)
  assertReleasePublication(assembled, release.split(" ")[1])
  return assembled
}

export function readReleaseNotes(root = repository) {
  return assembleReleaseNotes(readFileSync(join(root, notesPath), "utf8"), readChanges(root))
}

// The release step: the entries become part of release-notes.md.
export function foldChanges(root = repository) {
  const changes = readChanges(root)
  if (!changes.length) return changes
  const target = join(root, notesPath)
  writeFileSync(target, assembleReleaseNotes(readFileSync(target, "utf8"), changes))
  for (const change of changes) rmSync(join(root, changesDir, change.name))
  return changes
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !["--check", "--check-empty", "--fold"].includes(args[0])) {
    console.error("usage: node docs/tools/release-changes.mjs --check | --check-empty | --fold")
    process.exitCode = 2
  } else {
    try {
      if (args[0] === "--fold") console.log("release-changes: folded " + foldChanges().length + " entries into " + notesPath)
      else {
        const entries = readChanges()
        if (args[0] === "--check-empty" && entries.length) throw new Error("Fold outstanding changes before release: " + entries.map(change => change.name).join(", "))
        assembleReleaseNotes(readFileSync(join(repository, notesPath), "utf8"), entries)
        console.log("release-changes: " + entries.length + " unreleased entries in " + changesDir)
      }
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}

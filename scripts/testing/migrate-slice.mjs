#!/usr/bin/env node
// Prints the files one //packages:migrate-test run owns, one per line. The whole
// suite takes over an hour on four vCPUs, longer than a gate box reliably keeps
// its stream, so a gate splits it across boxes. scripts/migrate-test-slice holds
// one line, "i/n <host>", and applies only on the host it names, so a copy that
// reaches another checkout slices nothing. Every other run gets every file.
// Files are sorted and dealt in turn, so n runs cover each file exactly once.
import { existsSync, readFileSync } from "node:fs"
import { hostname } from "node:os"
import { pathToFileURL } from "node:url"

const sliceFile = new URL("../migrate-test-slice", import.meta.url)

export function parseSlice(text) {
  const [slice = "", host = ""] = text.trim().split(/\s+/)
  const match = /^([0-9]+)\/([0-9]+)$/.exec(slice)
  if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2])) throw new Error(`${slice} is not i/n with 1 <= i <= n`)
  return { index: Number(match[1]), count: Number(match[2]), host }
}

export function sliceFiles(files, { index, count }) {
  return [...new Set(files)].sort().filter((_, at) => at % count === index - 1)
}

export function selectedFiles(files, text, host = hostname()) {
  if (text === undefined) return files
  const slice = parseSlice(text)
  if (slice.host !== host) {
    console.error(`migrate-slice: ignoring scripts/migrate-test-slice: it names host ${slice.host || "(none)"}, this is ${host}`)
    return files
  }
  return sliceFiles(files, slice)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = existsSync(sliceFile) ? readFileSync(sliceFile, "utf8") : undefined
  try {
    const selected = selectedFiles(process.argv.slice(2), text)
    if (!selected.length) throw new Error("no test files selected")
    console.log(selected.join("\n"))
  } catch (error) {
    console.error("migrate-slice: " + error.message)
    process.exit(2)
  }
}

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const families = JSON.parse(readFileSync(new URL("map.json", import.meta.url), "utf8"))

export function select(paths) {
  const names = paths.map(path => path.replaceAll("\\", "/").replace(/^\.\//, ""))
  const mapChanged = names.some(path => path.startsWith("scripts/fuzz-gate/"))
  const selected = Object.entries(families).filter(([, family]) => mapChanged ||
    family.paths.some(pattern => names.some(path => new RegExp(pattern).test(path))))
    .map(([name]) => "//scripts/fuzz-gate:" + name)
  if (names.some(path => /^(templates\/|docs\/tools\/starter-templates\.test\.ts$|scripts\/starter-templates\.test\.mjs$|typescript\/tsc\/cmd\/vibelang-forms\/)/.test(path))) {
    selected.push("//:starter-templates")
  }
  if (names.some(path => /^typescript\/tsc\/internal\/vibelang\/fix_trusted_empty(?:[^/]*_test)?\.go$/.test(path))) {
    selected.push("//:trusted-empty-forwarding")
  }
  return selected.sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  let paths
  if (!args.length) paths = readFileSync(0, "utf8")
  else if (args.length === 2 && args[0] === "--base") {
    // Snapshot an applied patch even when the caller has not run jj status.
    // Do not hide a failed revision lookup: no paths would falsely pass a gate.
    paths = execFileSync("jj", ["diff", "--from", args[1], "--to", "@", "--name-only"], { encoding: "utf8" })
  } else if (args.length === 2 && args[0] === "--paths") paths = readFileSync(args[1], "utf8")
  else throw new Error("usage: node scripts/fuzz-gate/select.mjs [--base REV | --paths FILE]")
  const labels = select(paths.split(/\r?\n/).filter(Boolean))
  if (labels.length) process.stdout.write(labels.join("\n") + "\n")
}

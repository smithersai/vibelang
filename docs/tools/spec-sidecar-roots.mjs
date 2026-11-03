import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Recorded 2026-11-03 ruling: sidecarDir plays declarationDir. The option's
// relative value is config-relative; the source path within it is not always so.
export function missingRootAlternatives(text) {
  const normalized = text.replace(/`/g, "").replace(/\s+/g, " ");
  return ["rootDir", "composite", "common source directory"].filter(term => !normalized.includes(term));
}
export function checkSidecarRoots(root) {
  const vip = readFileSync(resolve(root, "vips/0027-declaration-output.md"), "utf8");
  const tooling = readFileSync(resolve(root, "src/007-tooling.md"), "utf8");
  const introduction = vip.split("\n\n").find(p => p.startsWith("The Location bullet"));
  const row = tooling.split("\n").find(p => p.startsWith("| `vibe.sidecarDir`"));
  const failures = [];
  for (const [name, text] of [["VIP-27 layout", introduction], ["sidecarDir option", row]]) {
    if (!text) { failures.push(name + ": missing authoritative rule"); continue; }
    const missing = missingRootAlternatives(text);
    if (missing.length) failures.push(name + ": omits source-root alternatives: " + missing.join(", "));
  }
  const section = vip.split("### Amendment: an opt-in sidecar directory")[1]?.split("## Prior art")[0] ?? "";
  if (!/"rootDir"\s*:\s*"\."/.test(section))
    failures.push("VIP-27 config-relative example must explicitly set rootDir to '.'");
  return failures;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkSidecarRoots(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../design"));
  for (const failure of failures) console.error(failure);
  process.exitCode = failures.length ? 1 : 0;
}

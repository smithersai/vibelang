import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { resolveSiteRelease } from "../../docs/tools/published-site.mjs"
import { kernelFacts } from "../../docs/tools/kernel-facts"
import { buildMarkdown } from "../../docs/tools/markdown"
const site = resolve(import.meta.dir, "..")
const releaseFile = resolve(site, "../.cache/site-release.json")
const factsFile = resolve(site, "../.cache/site-facts.json")
if (process.argv[2] === "--markdown") {
  buildMarkdown(resolve(site, "dist/public"), JSON.parse(readFileSync(factsFile, "utf8")), JSON.parse(readFileSync(releaseFile, "utf8")))
  // Vocs has rendered the selected npm release. Restore the committed candidate
  // sources so a build cannot change subsequent source checks or edits.
  const env = { ...process.env }
  delete env.VIBELANG_SITE_RELEASE_FILE
  const restored = Bun.spawnSync(["node", "scripts/sync-user-docs.mjs", "../docs/user"], { cwd: site, env, stdout: "inherit", stderr: "inherit" })
  if (restored.exitCode) process.exit(restored.exitCode)
} else {
  mkdirSync(resolve(site, "../.cache"), { recursive: true })
  writeFileSync(factsFile, JSON.stringify(kernelFacts()))
  if (!process.argv.includes("--sources")) {
    writeFileSync(releaseFile, JSON.stringify(resolveSiteRelease()))
    process.env.VIBELANG_SITE_RELEASE_FILE = releaseFile
  }
  for (const args of [
    ["scripts/sync-spec-docs.mjs", "../docs", "--facts", factsFile],
    ["scripts/sync-user-docs.mjs", "../docs/user"],
    ...(process.argv.includes("--sources") ? [] : [["scripts/patch-vocs-search.mjs"]]),
  ]) {
    const result = Bun.spawnSync(["node", ...args], { cwd: site, env: { ...process.env }, stdout: "inherit", stderr: "inherit" })
    if (result.exitCode) process.exit(result.exitCode)
  }
}

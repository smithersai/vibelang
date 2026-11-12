#!/usr/bin/env node
// The site's postdeploy check: the served pages against npm latest and this
// checkout's TypeScript version. The checks live in scripts/release/live-site.mjs,
// which a release bundle runs without a checkout.
import { resolveSiteRelease } from "./published-site.mjs"
import { checkLiveSite, deployedReleaseProblems, releaseRoutes, report } from "../../scripts/release/live-site.mjs"
import { readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export { deployedReleaseProblems, releaseRoutes }

// Compare real paths: run through a symlinked checkout, a plain comparison skipped every check and exited 0.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  // --version checks the served pages against that published release, read from
  // --registry (npm by default), instead of whatever npm latest is now.
  const usage = "usage: node docs/tools/deployed-release.mjs [--version <version>] [--registry <url>] [https://vibelang.sh]"
  const args = process.argv.slice(2)
  const take = name => { const at = args.indexOf(name); return at < 0 ? undefined : args.splice(at, 2)[1] ?? "" }
  const release = take("--version"), registry = take("--registry")
  if (args.length > 1 || release === "" || registry === "" || (registry !== undefined && release === undefined)) {
    console.error(usage)
    process.exitCode = 2
  } else {
    const core = readFileSync(new URL("../../typescript/tsc/internal/core/version.go", import.meta.url), "utf8")
    const typescriptVersion = /var version = "([^"]+)"/.exec(core)?.[1]
    if (!typescriptVersion) throw new Error("Invalid compiler release metadata")
    if (release) process.exitCode = await checkLiveSite({ release, registry, typescriptVersion, baseUrl: args[0], label: "deployed-release" })
    else {
      const manifest = resolveSiteRelease({ env: { ...process.env, VIBELANG_SITE_RELEASE_FILE: "" }, requirePublished: true }).compiler
      process.exitCode = report("deployed-release", manifest.version, await deployedReleaseProblems({ baseUrl: args[0], manifest, typescriptVersion }))
    }
  }
}

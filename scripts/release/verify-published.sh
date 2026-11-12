#!/bin/sh
# Checks a published VibeLang release from the public npm registry: scaffolds an
# app with npm and with Bun, installs, builds, starts, and tests it.
# First rejects publisher home paths anywhere in each package version manifest.
# VIBELANG_REGISTRY selects another registry for both checks.
#
#   sh scripts/release/verify-published.sh [version]
#
# The version defaults to the compiler package's version in this checkout.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
version=${1:-$(node -p 'require(process.argv[1]).version' "$root/packages/compiler/package.json")}
registry=${VIBELANG_REGISTRY:-https://registry.npmjs.org/}
node --input-type=module - "$registry" "$version" <<'JS'
const [registry, version] = process.argv.slice(2)
const homePath = /\/(?:Users|home)\//
function check(value, field, pkg) {
  if (typeof value === "string" && homePath.test(value)) {
    throw new Error(`${pkg}: ${field} contains a publisher home path`)
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) check(child, field ? `${field}.${key}` : key, pkg)
  }
}
async function manifest(name) {
  const pkg = `${name}@${version}`
  const url = new URL(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`, registry.replace(/\/?$/, "/"))
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${pkg}: registry manifest request failed (HTTP ${response.status})`)
  const value = await response.json()
  check(value, "", pkg)
  return value
}
try {
  const compiler = await manifest("vibelang")
  for (const name of [...Object.keys(compiler.optionalDependencies ?? {}),
    "vibelang-runtime", "vibelang-vite", "create-vibelang", "vibelang-unplugin"]) {
    await manifest(name)
  }
  console.log(`verify-published: ${version} registry manifests contain no publisher home paths`)
} catch (error) {
  console.error(`verify-published: ${error.message}`)
  process.exit(1)
}
JS
sh "$root/scripts/release/check-app.sh" "$registry" "$version" npm bun

#!/bin/sh
# Checks a published VibeLang release from the public npm registry. It first
# rejects publisher home paths anywhere in each package version manifest, then
# scaffolds an app with npm and with Bun, installs, builds, starts, and tests it,
# then checks that the live docs site describes the release.
#
#   sh scripts/release/verify-published.sh [version]
#
# The version defaults to the compiler package's version in this checkout. It runs
# from a checkout or from a release bundle that holds only scripts/release/.
# VIBELANG_REGISTRY and VIBELANG_SITE_URL point the checks at another registry
# and site, such as a local rehearsal.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
version=${1:-$(node -p 'require(process.argv[1]).version' "$root/packages/compiler/package.json")}
registry=${VIBELANG_REGISTRY:-https://registry.npmjs.org/}
site=${VIBELANG_SITE_URL:-https://vibelang.sh}
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
# The installation page, home page and setup Markdown must name this version,
# its pins and its platforms. Release notes must have the current heading;
# their historical pins and retired commands are excluded from instruction checks.
# A checkout also pins the TypeScript version in the documented --version output.
set -- --version "$version" --registry "$registry"
core="$root/typescript/tsc/internal/core/version.go"
if [ -f "$core" ]; then
  typescript=$(sed -n 's/.*var version = "\([^"]*\)".*/\1/p' "$core" | head -n 1)
  [ -z "$typescript" ] || set -- "$@" --typescript "$typescript"
fi
node "$root/scripts/release/live-site.mjs" "$@" "$site" ||
  { echo "verify-published: $site does not describe VibeLang $version. Deploy it with: sh scripts/release/deploy-site.sh $version" >&2; exit 1; }
echo "verify-published: VibeLang $version installs from $registry and $site describes it"

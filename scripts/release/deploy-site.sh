#!/bin/sh
# Deploys vibelang.sh for a release publish.sh has just published:
#
#   sh scripts/release/deploy-site.sh <version>
#
# The site states the version that npm's latest tag serves, so this refuses to
# deploy until npm latest is <version>. scripts/deploy-docs.sh then builds,
# checks and uploads the site, and its postdeploy check reads the served pages.
# Credentials: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
[ "$#" -eq 1 ] || { echo "usage: sh scripts/release/deploy-site.sh <version>" >&2; exit 2; }
version=$1
registry=${VIBELANG_REGISTRY:-https://registry.npmjs.org/}
latest=$(npm view vibelang version --registry "$registry" --prefer-online) ||
  { echo "deploy-site: cannot read npm latest from $registry" >&2; exit 1; }
if [ "$latest" != "$version" ]; then
  echo "deploy-site: npm latest is $latest, not $version; the site would describe $latest. Publish $version first, or wait for the registry to serve it." >&2
  exit 1
fi
# Rehearsal overrides would build the site for another version than npm serves.
unset VIBELANG_RELEASE_VERSION VIBELANG_SITE_RELEASE_FILE VIBELANG_SKIP_RELEASE_SNIPPETS VIBELANG_SKIP_RELEASE_SNIPPETS_REASON
echo "deploy-site: deploying vibelang.sh for VibeLang $version"
sh "$root/scripts/deploy-docs.sh"
echo "deploy-site: vibelang.sh describes VibeLang $version. Next: sh scripts/release/verify-published.sh $version"

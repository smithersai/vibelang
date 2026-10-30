#!/bin/sh
# Publishes VibeLang's eleven npm packages from dist-npm/tarballs/ in order: the six
# platform compilers, vibelang, vibelang-runtime, vibelang-vite, create-vibelang, and vibelang-unplugin.
# Run it yourself in a terminal, after npm login:
#
#   sh scripts/release/publish.sh            # asks for a one-time password once
#   sh scripts/release/publish.sh --dry-run  # checks everything, publishes nothing
#   sh scripts/release/publish.sh --otp 123456
#   NPM_OTP=123456 sh scripts/release/publish.sh
#   VIBELANG_SKIP=win32 sh scripts/release/publish.sh  # omits win32 packages and their optional dependencies
#
# An identical tarball already published at this version is skipped, so rerunning after a
# failure resumes where it stopped. If npm rejects the one-time password, the
# script asks for a new one and retries that package.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
tarballs="$root/dist-npm/tarballs"
# VIBELANG_REGISTRY points the script at another registry, such as a local Verdaccio.
registry=${VIBELANG_REGISTRY:-https://registry.npmjs.org/}
dry=""
otp=${NPM_OTP:-}
usage() {
  echo "usage: sh scripts/release/publish.sh [--dry-run] [--otp <one-time-password>]" >&2
  exit 2
}
while [ "$#" -gt 0 ]; do
  case $1 in
    --dry-run) dry=--dry-run; shift ;;
    --otp)
      [ "$#" -ge 2 ] && [ -n "$2" ] || usage
      case $2 in -*) usage ;; esac
      otp=$2
      shift 2 ;;
    *) usage ;;
  esac
done

[ -f "$tarballs/manifest.json" ] || {
  echo "publish: no dist-npm/tarballs/manifest.json. Run sh scripts/release/build-binaries.sh and node scripts/release/make-packages.mjs first." >&2
  exit 1
}
version=$(node -p 'require(process.argv[1]).version' "$tarballs/manifest.json")
node "$root/scripts/release/repack.mjs" "$tarballs"

if user=$(npm whoami --registry "$registry" 2>/dev/null); then
  echo "publish: logged in to npm as $user; publishing VibeLang $version"
elif [ -n "$dry" ]; then
  echo "publish: not logged in to npm; the dry run continues"
else
  echo "publish: you are not logged in to npm. Run npm login, then rerun this script." >&2
  exit 1
fi

todo=""
for item in $(node -e 'for (const p of require(process.argv[1]).packages) console.log(`${p.name}=${p.file}`)' "$tarballs/manifest.json"); do
  name=${item%%=*}
  file=${item#*=}
  packed=$(tar -xOzf "$tarballs/$file" package/package.json | node -p 'const p = JSON.parse(require("fs").readFileSync(0, "utf8")); `${p.name}@${p.version}`')
  [ "$packed" = "$name@$version" ] || { echo "publish: $file contains $packed, expected $name@$version" >&2; exit 1; }
  skipped=""
  for pattern in $(printf '%s' "${VIBELANG_SKIP:-}" | tr ',' ' '); do
    case $name in *"$pattern"*) skipped=$pattern ;; esac
  done
  if [ -n "$skipped" ]; then
    echo "publish: skipping $name@$version (VIBELANG_SKIP=$skipped)"
  elif registry_shasum=$(npm view "$name@$version" dist.shasum --registry "$registry" 2>/dev/null); then
    local_shasum=$(node -e 'const fs = require("node:fs"); const crypto = require("node:crypto"); console.log(crypto.createHash("sha1").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$tarballs/$file")
    [ "$registry_shasum" = "$local_shasum" ] || {
      echo "publish: $name@$version checksum mismatch: registry dist.shasum=$registry_shasum; local sha1=$local_shasum ($file). Refusing to publish; inspect the existing registry version and local tarball." >&2
      exit 1
    }
    echo "publish: $name@$version is already on npm with an identical tarball; skipping"
  else
    todo="$todo $item"
  fi
done
[ -n "$todo" ] || { echo "publish: every package not skipped is already on npm at $version."; exit 0; }

if [ -z "$dry" ] && [ -z "$otp" ]; then
  printf 'npm one-time password (press Enter if your account does not use one): '
  read -r otp
fi

for item in $todo; do
  name=${item%%=*}
  file=${item#*=}
  while :; do
    set -- npm publish "$tarballs/$file" --registry "$registry" --access public
    [ -z "$otp" ] || set -- "$@" --otp "$otp"
    [ -z "$dry" ] || set -- "$@" --dry-run
    if "$@"; then
      if [ -n "$dry" ]; then echo "publish: $name@$version checked (dry run)"; else echo "publish: $name@$version published"; fi
      break
    fi
    [ -z "$dry" ] || exit 1
    printf 'publish: %s failed. Enter a new one-time password to retry, or press Enter to stop: ' "$name"
    read -r otp
    [ -n "$otp" ] || { echo "publish: stopped. Rerun this script to resume." >&2; exit 1; }
  done
done

[ -n "$dry" ] && { echo "publish: dry run passed for $version"; exit 0; }
echo "publish: published VibeLang $version. Check it from the public registry with:"
echo "  sh scripts/release/verify-published.sh $version"

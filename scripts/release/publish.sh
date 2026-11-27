#!/bin/sh
# Publishes VibeLang's twelve npm packages from dist-npm/tarballs/ in order: the six
# platform compilers, vibelang, vibelang-runtime, vibelang-vite, create-vibelang, vibelang-unplugin,
# and vibelang-typescript, whose version is TypeScript's major and minor.
# Run it yourself in a terminal, after npm login:
#
#   sh scripts/release/publish.sh            # asks for a one-time password once
#   sh scripts/release/publish.sh --dry-run  # checks everything, publishes nothing
# Set NPM_OTP in the environment for noninteractive publishing.
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
unset NPM_OTP
usage() {
  echo "usage: sh scripts/release/publish.sh [--dry-run]" >&2
  exit 2
}
while [ "$#" -gt 0 ]; do
  case $1 in
    --dry-run) dry=--dry-run; shift ;;
    *) usage ;;
  esac
done

[ -f "$tarballs/manifest.json" ] || {
  echo "publish: no dist-npm/tarballs/manifest.json. Run sh scripts/release/build-binaries.sh and node scripts/release/make-packages.mjs first." >&2
  exit 1
}
version=$(node -p 'require(process.argv[1]).version' "$tarballs/manifest.json")
# The tarballs must come from this checkout's commit, with nothing uncommitted.
node "$root/scripts/release/revision.mjs" --manifest "$tarballs/manifest.json" "$root"
# repack derives vibelang's tarball from the full one on every run and fails
# unless it lists exactly the platform packages published below.
node "$root/scripts/release/repack.mjs" "$tarballs"

if user=$(npm whoami --registry "$registry" 2>/dev/null); then
  echo "publish: logged in to npm as $user; publishing VibeLang $version"
elif [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]; then
  echo "publish: using GitHub Actions OIDC trusted publishing for VibeLang $version"
elif [ -n "$dry" ]; then
  echo "publish: not logged in to npm; the dry run continues"
else
  echo "publish: you are not logged in to npm. Run npm login, then rerun this script." >&2
  exit 1
fi

todo=""
for item in $(node -e 'for (const p of require(process.argv[1]).packages) console.log(`${p.name}=${p.version}=${p.file}`)' "$tarballs/manifest.json"); do
  name=${item%%=*}
  rest=${item#*=}
  package_version=${rest%%=*}
  file=${rest#*=}
  packed=$(tar -xOzf "$tarballs/$file" package/package.json | node -p 'const p = JSON.parse(require("fs").readFileSync(0, "utf8")); `${p.name}@${p.version}`')
  [ "$packed" = "$name@$package_version" ] || { echo "publish: $file contains $packed, expected $name@$package_version" >&2; exit 1; }
  skipped=""
  for pattern in $(printf '%s' "${VIBELANG_SKIP:-}" | tr ',' ' '); do
    case $name in *"$pattern"*) skipped=$pattern ;; esac
  done
  if [ -n "$skipped" ]; then
    echo "publish: skipping $name@$package_version (VIBELANG_SKIP=$skipped)"
  elif registry_shasum=$(npm view "$name@$package_version" dist.shasum --registry "$registry" 2>/dev/null); then
    local_shasum=$(node -e 'const fs = require("node:fs"); const crypto = require("node:crypto"); console.log(crypto.createHash("sha1").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$tarballs/$file")
    [ "$registry_shasum" = "$local_shasum" ] || {
      echo "publish: $name@$package_version checksum mismatch: registry dist.shasum=$registry_shasum; local sha1=$local_shasum ($file). Refusing to publish; inspect the existing registry version and local tarball." >&2
      exit 1
    }
    echo "publish: $name@$package_version is already on npm with an identical tarball; skipping"
  else
    todo="$todo $item"
  fi
done
[ -n "$todo" ] || { echo "publish: every package not skipped is already on npm at $version."; exit 0; }

# npm records an absolute _resolved even for a relative tarball argument.
# Ignore TMPDIR: it may point into the publisher's home or release bundle.
stage=$(mktemp -d /tmp/vibelang-publish.XXXXXX)
tty_state=""
restore_tty() {
  if [ -n "$tty_state" ]; then
    stty "$tty_state"
    tty_state=""
  fi
}
trap 'restore_tty; rm -rf "$stage"' EXIT
trap 'exit 1' HUP INT TERM
stage=$(CDPATH= cd -- "$stage" && pwd -P)
for item in $todo; do
  file=${item##*=}
  publish_path="$stage/$file"
  case $publish_path in
    */Users/*|*/home/*)
      echo "publish: refusing npm tarball argument containing a home path" >&2; exit 1 ;;
  esac
  if [ -n "${HOME:-}" ]; then
    case $publish_path in
      *"$HOME"*) echo "publish: refusing npm tarball argument containing a home path" >&2; exit 1 ;;
    esac
  fi
  cp "$tarballs/$file" "$publish_path"
done

read_otp() {
  tty_state=$(stty -g)
  stty -echo
  printf '%s' "$1" >&2
  read_status=0
  IFS= read -r otp || read_status=$?
  restore_tty
  printf '\n' >&2
  return "$read_status"
}

interactive=0
if [ -t 0 ] && [ "${CI:-}" != "true" ]; then
  interactive=1
fi

if [ -z "$dry" ] && [ -z "$otp" ] && [ "$interactive" -eq 1 ]; then
  read_otp 'npm one-time password (press Enter if your account does not use one): '
fi

for item in $todo; do
  name=${item%%=*}
  rest=${item#*=}
  package_version=${rest%%=*}
  file=${rest#*=}
  while :; do
    set -- npm publish "$stage/$file" --registry "$registry" --access public
    if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ "$registry" = "https://registry.npmjs.org/" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]; then
      set -- "$@" --provenance
    fi
    [ -z "$dry" ] || set -- "$@" --dry-run
    if npm_config_otp="${otp:-${npm_config_otp:-}}" "$@"; then
      if [ -n "$dry" ]; then echo "publish: $name@$package_version checked (dry run)"; else echo "publish: $name@$package_version published"; fi
      break
    fi
    [ -z "$dry" ] || exit 1
    if [ "$interactive" -eq 0 ]; then
      echo "publish: $name@$package_version failed in non-interactive mode. Fix credentials or trusted publishing and rerun to resume." >&2
      exit 1
    fi
    read_otp "publish: $name failed. Enter a new one-time password to retry, or press Enter to stop: "
    [ -n "$otp" ] || { echo "publish: stopped. Rerun this script to resume." >&2; exit 1; }
  done
done

[ -n "$dry" ] && { echo "publish: dry run passed for $version"; exit 0; }
echo "publish: published VibeLang $version. Deploy vibelang.sh for it, then check both from the public registry:"
echo "  sh scripts/release/deploy-site.sh $version"
echo "  sh scripts/release/verify-published.sh $version"

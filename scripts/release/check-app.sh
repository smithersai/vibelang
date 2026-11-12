#!/bin/sh
# Scaffolds a new VibeLang app from a registry with each named package manager,
# then installs, checks the installed formatter, builds, starts, and tests it,
# checks the built app with the dprint.json the formatting guide documents, and
# checks that a first git commit of it tracks no generated file.
# Checks the compiler version and resolves optional packages without hoisting.
# npm also reinstalls from its generated lockfile with npm ci. bun-isolated
# scaffolds with Bun, then reinstalls with Bun's isolated linker, the layout
# Bun workspaces use, where each package sees only its declared dependencies.
#
#   sh scripts/release/check-app.sh <registry-url> <version> npm bun pnpm bun-isolated
#
# The npm user config and package-manager caches point into a temporary
# directory, so the check uses fresh registry installs. KEEP=1
# keeps that directory for inspection.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
registry=$1
version=$2
shift 2
[ "$#" -gt 0 ] || set -- npm bun pnpm
# A registry rehearsal must run the compiler and runtime installed in its app.
unset VIBELANG_BINARY VIBELANG_RUNTIME VIBELANG_RUNTIME_DIR EFFECT_NODE_MODULES
scratch=$(mktemp -d "${TMPDIR:-/tmp}/vibelang-check.XXXXXX")
trap '[ -n "${KEEP:-}" ] && echo "check-app: kept $scratch" || rm -rf "$scratch"' EXIT

mkdir -p "$scratch/home"
export npm_config_userconfig="$scratch/home/.npmrc" NPM_CONFIG_USERCONFIG="$scratch/home/.npmrc"
export npm_config_registry="$registry" NPM_CONFIG_REGISTRY="$registry" BUN_CONFIG_REGISTRY="$registry"
# pnpm 11 and later use their own configuration environment namespace.
export pnpm_config_registry="$registry" PNPM_CONFIG_REGISTRY="$registry"
export npm_config_cache="$scratch/npm-cache" BUN_INSTALL_CACHE_DIR="$scratch/bun-cache"
# bun create runs bunx, which keeps create-vibelang under $TMPDIR across runs
# and reuses it even when the registry has a newer tarball of that version, so
# an earlier rehearsal's template would be scaffolded. A scratch TMPDIR starts it clean.
# (https://github.com/oven-sh/bun/issues/12245; bunx re-resolves a bare name only after 24 hours.)
# Every manager scaffolds the requested version, never the latest tag.
export TMPDIR="$scratch/tmp"
mkdir -p "$TMPDIR"
export npm_config_yes=true npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin-arm64 ;;
  Darwin-x86_64) platform=darwin-x64 ;;
  Linux-x86_64) platform=linux-x64 ;;
  Linux-aarch64) platform=linux-arm64 ;;
  *) echo "check-app: unsupported platform $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

for manager in "$@"; do
  app="$scratch/$manager-app"
  export DPRINT_CACHE_DIR="$scratch/$manager-dprint-cache" VIBELANG_DISABLE_CACHE=1
  step() { echo "check-app: $manager: $*"; }
  cd "$scratch"
  # The command that installs, adds and runs scripts for this manager.
  tool=$manager
  case $manager in
    npm) step "npm create vibelang@$version"; npm create "vibelang@$version" "$manager-app" ;;
    pnpm) step "pnpm create vibelang@$version"; pnpm create "vibelang@$version" "$manager-app" --no-install ;;
    bun) step "bun create vibelang@$version"; bun create "vibelang@$version" "$manager-app" ;;
    bun-isolated) tool=bun; step "bun create vibelang@$version"; bun create "vibelang@$version" "$manager-app" ;;
    *) echo "check-app: unknown package manager $manager" >&2; exit 1 ;;
  esac
  cd "$app"
  if [ "$manager" = bun-isolated ]; then
    # bun create installs with the hoisted linker. Reinstall isolated, and keep
    # the linker in bunfig.toml so the later bun add stays isolated too.
    printf '[install]\nlinker = "isolated"\n' >bunfig.toml
    rm -rf node_modules
    step "bun install --linker isolated"
    bun install --linker isolated
    [ -d node_modules/.bun ] && [ -L node_modules/vibelang ] || {
      echo "check-app: $manager: bun install did not produce the isolated layout" >&2; exit 1; }
  fi
  if [ "$manager" = pnpm ]; then
    # pnpm requires explicit approval for dprint's binary-install script.
    # Keep isolated dependency linking and a fresh content-addressable store.
    cat >pnpm-workspace.yaml <<EOF
allowBuilds:
  dprint: true
storeDir: $scratch/pnpm-store
EOF
  fi
  [ -d node_modules ] || { step "install"; "$tool" install; }
  if [ "$manager" = npm ]; then
    step "npm ci"
    npm ci
  fi

  step "installed packages"
  node --input-type=module - "$version" "$platform" <<'JS'
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
const [version, platform] = process.argv.slice(2)
const manifest = (name) => JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"))
for (const name of ["vibelang", "vibelang-runtime", "vibelang-vite"]) {
  if (manifest(name).version !== version) throw new Error(`${name} is ${manifest(name).version}, expected ${version}`)
}
// pnpm keeps optional dependencies beside the compiler in its virtual store.
const expectedFormat = process.env.VIBELANG_REHEARSAL_FORMAT_SHA256
if (expectedFormat) {
  const actualFormat = createHash("sha256").update(readFileSync("node_modules/vibelang/format.mjs")).digest("hex")
  if (actualFormat !== expectedFormat) throw new Error(`vibelang formatter checksum ${actualFormat}, expected candidate ${expectedFormat}; check the install registry`)
  console.log(`check-app: candidate formatter SHA-256 ${actualFormat}`)
}
const compiler = createRequire(realpathSync("node_modules/vibelang/package.json"))
const platformName = `vibelang-${platform}`
const platformManifest = JSON.parse(readFileSync(compiler.resolve(`${platformName}/package.json`), "utf8"))
if (platformManifest.version !== version) throw new Error(`${platformName} is ${platformManifest.version}, expected ${version}`)
if (existsSync("node_modules/vibelang/native")) throw new Error("vibelang ships a native/ directory")
if (!existsSync("node_modules/vibelang/editor/vibelang.vsix")) throw new Error("vibelang lacks editor/vibelang.vsix")
// Node resolves imports from a module's real path: the runtime and the app must load one effect.
const runtime = createRequire(realpathSync("node_modules/vibelang-runtime/dist/index.js")).resolve("effect")
const project = createRequire(realpathSync("package.json")).resolve("effect")
if (runtime !== project) throw new Error(`the runtime loads ${runtime}, the app loads ${project}`)
console.log(`check-app: vibelang, vibelang-runtime, vibelang-vite, vibelang-${platform} at ${version}; one copy of effect`)
JS

  step "vibelang --version"
  printed=$(node_modules/.bin/vibelang --version)
  case $printed in
    "VibeLang $version ("*) echo "check-app: $printed" ;;
    *) echo "check-app: vibelang --version printed '$printed'" >&2; exit 1 ;;
  esac

  # Exercise the installed companion before any formatter cache can hide a
  # plugin-resolution failure.
  step "vibelang-format --check src"
  node_modules/.bin/vibelang-format --check 'src/**/*.{vibe,vibex}'
  step "run build"
  "$tool" run build
  step "run start"
  "$tool" run start >"$scratch/$manager-start.txt" 2>&1 || { cat "$scratch/$manager-start.txt"; exit 1; }
  cat "$scratch/$manager-start.txt"
  /usr/bin/grep -Fq 'Hello, VibeLang!' "$scratch/$manager-start.txt"
  /usr/bin/grep -Fq 'Recovered from EmptyName' "$scratch/$manager-start.txt"
  step "run test"
  "$tool" run test
  # Format the built app with the dprint.json the formatting guide documents,
  # byte for byte, so the rehearsal checks what a user copies. After build and
  # test, the compiler's generated declarations are present.
  step "dprint check (docs/user/src/setup/formatting.md)"
  awk '/^```json$/ { found = 1; next } found && /^```$/ { exit } found' "$root/docs/user/src/setup/formatting.md" >dprint.json
  [ -s dprint.json ] || { echo "check-app: no dprint.json in docs/user/src/setup/formatting.md" >&2; exit 1; }
  case $manager in
    npm) npm install --save-dev --save-exact dprint@0.64.3 ;;
    *) "$tool" add --save-dev --save-exact dprint@0.64.3 ;;
  esac
  node_modules/.bin/dprint check
  # A first commit of the built and tested app tracks only its sources: the
  # starter's .gitignore covers the declarations, receipts and build output.
  step "first commit tracks no generated file"
  git init -q
  git add -A
  git -c user.name=check-app -c user.email=check-app@example.invalid commit -qm starter
  generated=$(git ls-files | /usr/bin/grep -E '\.d\.(vibe\.|vibex\.)?ts$|\.vibelang-sidecar-|^dist/|^\.vibe/|^node_modules/' || true)
  if [ -n "$generated" ] || [ -n "$(git status --porcelain)" ]; then
    echo "check-app: $manager: the first commit tracks generated files:" >&2
    echo "$generated" >&2
    exit 1
  fi
  rm -rf .git
  # A warning used to exit 0 while suppressing emit under noEmitOnError.
  # Import that module through Vite, which always enables noEmitOnError.
  step "Vite warning-only .vibe import"
  mkdir warning-vite
  cat >warning-vite/tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ESNext", "DOM"],
    "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "types": [], "skipLibCheck": true,
    "rewriteRelativeImportExtensions": true, "noEmitOnError": true
  },
  "include": ["*.ts", "*.vibe"]
}
JSON
  cat >warning-vite/warning.vibe <<'VIBE'
import { Effect } from "effect"
export const stamp: Effect.Effect<number, never, never> = Effect.succeed(42)
VIBE
  cat >warning-vite/main.ts <<'TS'
import { stamp } from "./warning.vibe"
console.log("warning-only-vite-import", stamp)
TS
  cat >warning-vite/index.html <<'HTML'
<script type="module" src="/main.ts"></script>
HTML
  cat >warning-vite/vite.config.mjs <<'JS'
import vibelang from "vibelang-vite"
export default { plugins: [vibelang()] }
JS
  if ! node_modules/.bin/vite build warning-vite >"$scratch/$manager-vite.txt" 2>&1; then
    cat "$scratch/$manager-vite.txt"
    exit 1
  fi
  cat "$scratch/$manager-vite.txt"
  /usr/bin/grep -Fq 'warning EK4833' "$scratch/$manager-vite.txt"
  /usr/bin/grep -Fq 'warning-only-vite-import' warning-vite/dist/assets/*.js
  step "Vite warning-only .vibe import: PASS (1 warning, emitted bundle)"
  if [ "$manager" = npm ]; then
    step "install vibelang-unplugin"
    npm install --save-dev --save-exact "vibelang-unplugin@$version"
    node --input-type=module - "$version" <<'JS'
import { readFileSync } from "node:fs"
const [version] = process.argv.slice(2)
const installed = JSON.parse(readFileSync("node_modules/vibelang-unplugin/package.json", "utf8")).version
if (installed !== version) throw new Error(`vibelang-unplugin is ${installed}, expected ${version}`)
const { unplugin } = await import("vibelang-unplugin")
for (const bundler of ["webpack", "rspack", "rollup", "rolldown", "esbuild", "bun"]) {
  // unplugin builds each bundler's factory on access, so compare kinds, not identity.
  const { default: plugin } = await import(`vibelang-unplugin/${bundler}`)
  if (typeof plugin !== "function" || typeof unplugin[bundler] !== "function") throw new Error(`vibelang-unplugin/${bundler} does not export its plugin`)
}
console.log(`check-app: vibelang-unplugin ${version} loads its webpack, rspack, rollup, rolldown, esbuild and bun plugins`)
JS
  fi
  echo "check-app: $manager: PASS"
done
echo "check-app: PASS ($* on $platform, VibeLang $version from $registry)"

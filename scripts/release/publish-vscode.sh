#!/bin/sh
# Builds, verifies, and publishes the Vibe VS Code extension (editors/vscode/vibelang.vsix)
# to the Visual Studio Marketplace and/or Open VSX Registry.
#
#   sh scripts/release/publish-vscode.sh --dry-run [--allow-dirty]
#   VSCE_PAT=... sh scripts/release/publish-vscode.sh --marketplace
#   OVSX_PAT=... sh scripts/release/publish-vscode.sh --openvsx
#   VSCE_PAT=... OVSX_PAT=... sh scripts/release/publish-vscode.sh --marketplace --openvsx
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ext_dir="$root/editors/vscode"
vsix="$ext_dir/vibelang.vsix"

usage() {
  cat <<'EOF'
Usage: sh scripts/release/publish-vscode.sh [options]

Options:
  --dry-run        Verify metadata, version alignment, build, and VSIX package without publishing.
  --marketplace    Publish editors/vscode/vibelang.vsix to the VS Code Marketplace (requires VSCE_PAT).
  --openvsx        Publish editors/vscode/vibelang.vsix to Open VSX Registry (requires OVSX_PAT).
  --all            Shorthand for --marketplace --openvsx.
  --allow-dirty    Allow uncommitted working-copy changes (only permitted with --dry-run).
  --skip-install   Skip `bun install --frozen-lockfile` if editors/vscode/node_modules already exists.
  -h, --help       Show this help text.
EOF
}

dry_run=0
do_marketplace=0
do_openvsx=0
allow_dirty=0
skip_install=0

if [ "$#" -eq 0 ]; then
  usage >&2
  exit 2
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --marketplace) do_marketplace=1 ;;
    --openvsx) do_openvsx=1 ;;
    --all) do_marketplace=1; do_openvsx=1 ;;
    --allow-dirty) allow_dirty=1 ;;
    --skip-install) skip_install=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "publish-vscode: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ "$dry_run" -eq 0 ] && [ "$do_marketplace" -eq 0 ] && [ "$do_openvsx" -eq 0 ]; then
  echo "publish-vscode: specify --dry-run, --marketplace, --openvsx, or --all" >&2
  exit 2
fi

if [ "$allow_dirty" -eq 1 ] && [ "$dry_run" -eq 0 ]; then
  echo "publish-vscode: --allow-dirty is only permitted with --dry-run" >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "publish-vscode: node is required." >&2; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "publish-vscode: bun is required." >&2; exit 1; }

# 1. Verify clean working tree (via repo's revision.mjs, which supports jj and git).
record=$(node "$root/scripts/release/revision.mjs" "$root")
revision=${record% *}
clean=${record#* }
if [ "$clean" != "true" ]; then
  if [ "$allow_dirty" -eq 1 ]; then
    echo "publish-vscode: warning: working tree has uncommitted changes (allowed by --allow-dirty)" >&2
  else
    echo "publish-vscode: working tree is not clean (revision $revision); commit changes first." >&2
    exit 1
  fi
fi

# 2. Verify extension metadata and version lockstep with the compiler.
version=$(node - "$root" <<'NODE'
const { existsSync, readFileSync } = require("node:fs")
const { join } = require("node:path")

const root = process.argv[2]
const extPkg = JSON.parse(readFileSync(join(root, "editors/vscode/package.json"), "utf8"))
const compilerPkg = JSON.parse(readFileSync(join(root, "packages/compiler/package.json"), "utf8"))
const identity = readFileSync(join(root, "typescript/tsc/internal/vibelang/identity.go"), "utf8")
const goVersion = /const Version = "([^"]+)"/.exec(identity)?.[1]

const errors = []
if (!goVersion) errors.push("typescript/tsc/internal/vibelang/identity.go: missing Version constant")
if (extPkg.version !== compilerPkg.version) {
  errors.push(`editors/vscode/package.json version (${extPkg.version}) != packages/compiler/package.json (${compilerPkg.version})`)
}
if (goVersion && extPkg.version !== goVersion) {
  errors.push(`editors/vscode/package.json version (${extPkg.version}) != identity.go (${goVersion})`)
}
if (!extPkg.publisher) errors.push("editors/vscode/package.json: missing publisher")
if (!extPkg.icon || !/\.png$/i.test(extPkg.icon)) {
  errors.push(`editors/vscode/package.json: icon must be a .png path (got ${JSON.stringify(extPkg.icon)})`)
} else if (!existsSync(join(root, "editors/vscode", extPkg.icon))) {
  errors.push(`editors/vscode/${extPkg.icon}: icon file is missing`)
}
if (!extPkg.galleryBanner?.color || !extPkg.galleryBanner?.theme) {
  errors.push("editors/vscode/package.json: galleryBanner.color and galleryBanner.theme are required")
}
if (!extPkg.qna) errors.push("editors/vscode/package.json: qna is required")
if (!extPkg.homepage) errors.push("editors/vscode/package.json: homepage is required")
if (!extPkg.repository?.url) errors.push("editors/vscode/package.json: repository.url is required")
if (!extPkg.bugs?.url) errors.push("editors/vscode/package.json: bugs.url is required")
for (const doc of ["README.md", "CHANGELOG.md"]) {
  if (!existsSync(join(root, "editors/vscode", doc))) {
    errors.push(`editors/vscode/${doc}: required marketplace file is missing`)
  }
}

if (errors.length) {
  for (const e of errors) console.error("publish-vscode: " + e)
  process.exit(1)
}
console.log(extPkg.version)
NODE
)

echo "publish-vscode: verified vibelang.vibelang@$version (revision $revision, clean=$clean)"

# 3. Install dependencies, bundle, package .vsix, and run packaging verification tests.
if [ "$skip_install" -eq 0 ] || [ ! -d "$ext_dir/node_modules" ]; then
  (cd "$ext_dir" && bun install --frozen-lockfile)
fi

rm -f "$vsix"
(cd "$ext_dir" && bun run package)

if [ ! -s "$vsix" ]; then
  echo "publish-vscode: expected non-empty VSIX at $vsix" >&2
  exit 1
fi

sha256=$(node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  console.log(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
' "$vsix")
size=$(wc -c < "$vsix" | tr -d ' ')
echo "publish-vscode: packaged $vsix ($size bytes, sha256:$sha256)"

if [ "$dry_run" -eq 1 ]; then
  echo "publish-vscode: dry-run contents:"
  unzip -Z1 "$vsix" | sed 's/^/  /'
  echo "publish-vscode: dry-run passed for vibelang.vibelang@$version"
  echo "  Marketplace: VSCE_PAT=<token> sh scripts/release/publish-vscode.sh --marketplace"
  echo "  Open VSX:    OVSX_PAT=<token> sh scripts/release/publish-vscode.sh --openvsx"
  exit 0
fi

if [ "$do_marketplace" -eq 1 ]; then
  if [ -z "${VSCE_PAT:-}" ]; then
    echo "publish-vscode: VSCE_PAT is required for --marketplace" >&2
    exit 1
  fi
  echo "publish-vscode: publishing vibelang.vibelang@$version to VS Code Marketplace..."
  (cd "$ext_dir" && ./node_modules/.bin/vsce publish --packagePath "$vsix" --pat "$VSCE_PAT")
  echo "publish-vscode: published to VS Code Marketplace"
fi

if [ "$do_openvsx" -eq 1 ]; then
  if [ -z "${OVSX_PAT:-}" ]; then
    echo "publish-vscode: OVSX_PAT is required for --openvsx" >&2
    exit 1
  fi
  echo "publish-vscode: publishing vibelang.vibelang@$version to Open VSX Registry..."
  if command -v ovsx >/dev/null 2>&1; then
    ovsx publish "$vsix" -p "$OVSX_PAT"
  else
    bunx ovsx@0.10.10 publish "$vsix" -p "$OVSX_PAT"
  fi
  echo "publish-vscode: published to Open VSX Registry"
fi

#!/bin/sh
# Installs vibelang-typescript from a registry into a fresh create-vite project
# as npm alias of typescript, and checks tsc, the language server, Vite, the
# build's output, a clean install, a read-only tree, peer ranges, a stock
# TypeScript beside it, a monorepo override, pnpm, and uninstalling.
#
#   sh scripts/release/check-typescript-shim.sh <registry> <vibelang version> <shim version>
#
# rehearse.sh runs this against its throwaway registry.
set -eu
registry=$1
version=$2
shim=$3
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/vibelang-shim-check.XXXXXX")
trap 'chmod -R u+w "$scratch" 2>/dev/null || true; rm -rf "$scratch"' EXIT HUP INT TERM
export npm_config_registry="$registry"
export pnpm_config_registry="$registry" PNPM_CONFIG_REGISTRY="$registry"
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
effect=$(npm view "vibelang-runtime@$version" peerDependencies.effect)
step() { echo "check-typescript-shim: $1"; }
fails() { # expected-output-pattern command...: the command must exit non-zero and print the pattern
  pattern=$1; shift
  if output=$("$@" 2>&1); then echo "$output" >&2; echo "check-typescript-shim: expected failure from: $*" >&2; exit 1; fi
  printf '%s\n' "$output" | /usr/bin/grep -Eq "$pattern" || { echo "$output" >&2; echo "check-typescript-shim: no $pattern in output of: $*" >&2; exit 1; }
}
hello() {
  mkdir -p "$1"
  cat >"$1/hello.ts" <<'V'
// @vibe
error Empty

effect function greet(name: string) {
  if (name === "") throw new Empty()
  return `hello ${name}`
}

export effect function main() {
  const who = greet("") catch () => "nobody"
  return try greet(who)
}
V
}

step "create a project"
cd "$scratch"
npm create vite@9.3.4 app -- --template vanilla-ts --no-interactive --no-immediate >/dev/null
cd app
npm install >/dev/null
npx tsc --version | /usr/bin/grep -Fq "Version 7." || { echo "check-typescript-shim: expected a stock tsc first" >&2; exit 1; }
cp package.json ../package.stock.json

step "alias typescript to vibelang-typescript@$shim"
npm install --save-dev "typescript@npm:vibelang-typescript@$shim" "vibelang-vite@$version" >/dev/null
npm install "effect@$effect" "vibelang-runtime@$version" >/dev/null
npx tsc --version | /usr/bin/grep -Fq "VibeLang $version" || { npx tsc --version >&2; echo "check-typescript-shim: tsc is not VibeLang $version" >&2; exit 1; }
[ "$(node -p 'require("./node_modules/typescript/package.json").name')" = vibelang-typescript ]
/usr/bin/grep -Fq "vibelang-typescript" package-lock.json

hello src
cat >src/run.ts <<'V'
import { Effect } from "effect"
import { main } from "./hello.ts"
console.log(await Effect.runPromise(main()))
V
cat >vite.config.ts <<'V'
import { defineConfig } from "vite"
import vibelang from "vibelang-vite"
export default defineConfig({ plugins: [vibelang()], build: { ssr: "src/run.ts", outDir: "dist-ssr" } })
V

step "tsc checks the project"
npx tsc
step "tsc reports an error in the file"
cp src/hello.ts ../hello.good
sed -i.bak 's/return `hello ${name}`/return 1 + nope/' src/hello.ts
fails 'src/hello.ts\(6,[0-9]+\): error TS2304' npx tsc
cp ../hello.good src/hello.ts; rm -f src/hello.ts.bak

step "tsc emits, and the output runs"
npx tsc --noEmit false --outDir out --rootDir src --allowImportingTsExtensions false --rewriteRelativeImportExtensions true --declaration
[ "$(node out/run.js)" = "hello nobody" ]
/usr/bin/grep -Fq "main(): Effect.Effect<string, Empty, never>" out/hello.d.ts
rm -rf out

step "the language server reads the file"
node "$root/scripts/release/check-typescript-shim-lsp.mjs" "$PWD"

step "vite builds, and the bundle runs"
npx vite build >/dev/null
[ "$(node dist-ssr/run.js)" = "hello nobody" ]

step "npm ci without scripts keeps the compiler"
rm -rf node_modules
npm ci --ignore-scripts >/dev/null
npx tsc

step "a read-only tree needs no patching"
chmod -R a-w node_modules
npx tsc
chmod -R u+w node_modules

step "a required peer range on typescript accepts the package"
npm install --save-dev ts-api-utils@2.5.0 >/dev/null

step "a stock TypeScript a dependency installs refuses the file, and tsc stays VibeLang"
stock=$(node -p 'require(process.argv[1]).devDependencies.typescript.replace(/^[~^]/, "")' "$scratch/package.stock.json")
mkdir ../needs-stock
printf '{"name":"needs-stock","version":"1.0.0","dependencies":{"typescript":"%s"}}\n' "$stock" >../needs-stock/package.json
(cd .. && npm pack ./needs-stock >/dev/null)
npm install --save-dev ../needs-stock-1.0.0.tgz >/dev/null
fails 'src/hello.ts\(2,1\): error TS1434' node_modules/needs-stock/node_modules/.bin/tsc -p tsconfig.json --noEmit
npx tsc --version | /usr/bin/grep -Fq "VibeLang $version"
npm uninstall needs-stock ts-api-utils >/dev/null

step "stock Vite without the plugin refuses the file"
printf 'export default { build: { ssr: "src/run.ts", outDir: "dist-stock" } }\n' >vite.stock.config.ts
fails 'hello\.ts' npx vite build --config vite.stock.config.ts
rm vite.stock.config.ts

step "uninstalling restores TypeScript"
cp ../package.stock.json package.json
rm -rf node_modules package-lock.json vite.config.ts dist-ssr
npm install >/dev/null
npx tsc --version | /usr/bin/grep -Fq "Version 7."
if /usr/bin/grep -q "vibelang" package-lock.json; then echo "check-typescript-shim: the lockfile still names vibelang" >&2; exit 1; fi
fails 'src/hello.ts\(2,1\): error TS1434' npx tsc
rm src/hello.ts src/run.ts
npx tsc

step "a monorepo override replaces every typescript"
mkdir "$scratch/mono" "$scratch/mono/packages" "$scratch/mono/packages/a" "$scratch/mono/packages/b"
cd "$scratch/mono"
cat >package.json <<J
{"name":"mono","private":true,"workspaces":["packages/*"],"devDependencies":{"typescript":"npm:vibelang-typescript@$shim"},"overrides":{"typescript":"\$typescript"}}
J
for name in a b; do
  cat >"packages/$name/package.json" <<J
{"name":"$name","private":true,"type":"module","devDependencies":{"typescript":"^7.0.0"},"dependencies":{"effect":"$effect","vibelang-runtime":"$version"}}
J
  cat >"packages/$name/tsconfig.json" <<'J'
{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noEmit":true,"skipLibCheck":true,"types":[]},"include":["src"]}
J
  hello "packages/$name/src"
done
npm install >/dev/null
for name in a b; do (cd "packages/$name" && npx tsc && npx tsc --version | /usr/bin/grep -Fq "VibeLang $version"); done

step "pnpm installs the alias"
mkdir "$scratch/pnpm"
cd "$scratch/pnpm"
cat >package.json <<J
{"name":"p","private":true,"type":"module","devDependencies":{"typescript":"npm:vibelang-typescript@$shim"},"dependencies":{"effect":"$effect","vibelang-runtime":"$version"}}
J
cat >tsconfig.json <<'J'
{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noEmit":true,"skipLibCheck":true,"types":[]},"include":["src"]}
J
hello src
printf 'allowBuilds:\n  dprint: true\n' >pnpm-workspace.yaml
npx --yes pnpm@12.18.0 install --ignore-scripts --registry "$registry" >/dev/null
npx --yes pnpm@12.18.0 exec tsc
npx --yes pnpm@12.18.0 exec tsc --version | /usr/bin/grep -Fq "VibeLang $version"

step "a pnpm workspace override replaces every typescript"
mkdir "$scratch/pnpm-mono" "$scratch/pnpm-mono/a"
cd "$scratch/pnpm-mono"
printf 'packages:\n  - a\nallowBuilds:\n  dprint: true\noverrides:\n  typescript: npm:vibelang-typescript@%s\n' "$shim" >pnpm-workspace.yaml
printf '{"name":"pm","private":true}\n' >package.json
cat >a/package.json <<J
{"name":"a","private":true,"type":"module","devDependencies":{"typescript":"^7.0.0"},"dependencies":{"effect":"$effect","vibelang-runtime":"$version"}}
J
cp ../pnpm/tsconfig.json a/tsconfig.json
hello a/src
npx --yes pnpm@12.18.0 install --ignore-scripts --registry "$registry" >/dev/null
(cd a && npx --yes pnpm@12.18.0 exec tsc && npx --yes pnpm@12.18.0 exec tsc --version | /usr/bin/grep -Fq "VibeLang $version")

step "bun installs the alias"
mkdir "$scratch/bun"
cd "$scratch/bun"
cat >package.json <<J
{"name":"b","private":true,"type":"module","devDependencies":{"typescript":"npm:vibelang-typescript@$shim"},"dependencies":{"effect":"$effect","vibelang-runtime":"$version"}}
J
cp ../pnpm/tsconfig.json tsconfig.json
hello src
bun install --registry "$registry" >/dev/null
node_modules/.bin/tsc
node_modules/.bin/tsc --version | /usr/bin/grep -Fq "VibeLang $version"

echo "check-typescript-shim: PASS"

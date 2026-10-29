#!/usr/bin/env bash
# End-to-end check of VibeLang's TypeScript 7 content mapper with stock tools:
# stock TypeScript 7 (the typescript version package.json pins in
# devDependencies, not the VibeLang fork) checks a
# project in which main.ts imports ./greet.vibe through vibelang-ts-mapper.
#
#   packages/ts-mapper/test/e2e.sh
#
# Steps:
#   1. Install that typescript and effect 4.1.0 into test/.cache.
#   2. go test the projector and the protocol server, whose stock-compiler
#      tests run that typescript and fail rather than skip without it, and
#      check that the generated L1 forms table matches a fresh generation
#      (scripts/check-forms-table.sh; never hand-edit the table).
#   3. Build bin/vibelang-mapper, then assemble the fixture in a temporary
#      directory whose node_modules hold a copy of this package, effect, and
#      vibelang-runtime built from packages/runtime.
#   4. tsc --runExternalCode must print exactly test/expected-tsc.txt: one
#      error in main.ts (a misuse of greet's inferred type) and one in
#      greet.vibe, at its .vibe position. forms-check.ts pins the
#      types each lambda form projects to (forms.vibe): a wrong form
#      adds a TS2322 there.
#   5. The stock language server must answer hovers and diagnostics at
#      .vibe positions (test/lsp-hover.mjs).
#   6. A project whose .vibe files compile to .js (test/emit-fixture:
#      outputExtensions { ".vibe": ".js" } and rewriteRelativeImportExtensions):
#      stock tsc must emit main.js importing ./hello.js and hello.d.ts,
#      vibelang-mapper --emit writes hello.js, and node must run main.js.
#   7. Without effect beside the prelude, the sentinel on each projected
#      file's first line must report TS1360 at line 1, naming the fix.
#
# Environment:
#   TS7_VERSION  typescript version to test (default: devDependencies.typescript
#                in package.json)
#   EFFECT_DIR   an installed effect 4.1.0 to use instead of the cached one
#   VIBELANG_BINARY  a compiler from this checkout; skips the properties' Go build
#   FC_*         property selection, run count, seed, replay path and artifact directory
#   KEEP=1       keep the temporary project and print its path
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package="$(cd "$here/.." && pwd)"
root="$(cd "$package/../.." && pwd)"
ts7_version="${TS7_VERSION:-$(node -e 'process.stdout.write(require(process.argv[1]).devDependencies.typescript)' "$package/package.json")}"

step() { printf '\n== %s\n' "$*"; }

step "install typescript@$ts7_version and effect@4.1.0"
cache="$here/.cache/typescript-$ts7_version"
if [ ! -x "$cache/node_modules/.bin/tsc" ] || [ ! -f "$cache/node_modules/effect/package.json" ]; then
  mkdir -p "$cache"
  (cd "$cache" && printf '{"private":true}\n' > package.json && npm install --no-audit --no-fund --silent "typescript@$ts7_version" effect@4.1.0)
fi
tsc="$cache/node_modules/.bin/tsc"
effect_dir="${EFFECT_DIR:-$cache/node_modules/effect}"
"$tsc" --version

step "install locked property-test dependencies"
(cd "$package" && bun install --frozen-lockfile --ignore-scripts --no-cache --omit peer)

step "go test ./internal/vibelangmapper"
(cd "$root/typescript/tsc" && TS7_VERSION="$ts7_version" VIBELANG_REQUIRE_STOCK_TYPESCRIPT=1 CGO_ENABLED=0 go test -trimpath -gcflags=all=-dwarf=false ./internal/vibelangmapper/)

step "forms table matches its generator"
[ -d "$root/docs/tools/node_modules" ] || (cd "$root/docs/tools" && bun install --silent)
bash "$root/scripts/check-forms-table.sh"

step "build bin/vibelang-mapper"
(cd "$root/typescript/tsc" && CGO_ENABLED=0 go build -trimpath -gcflags=all=-dwarf=false -o "$package/bin/vibelang-mapper" ./cmd/vibelang-mapper)

step "assemble the fixture"
[ -f "$effect_dir/package.json" ] || { echo "e2e: no effect at $effect_dir; set EFFECT_DIR" >&2; exit 1; }
work="$(mktemp -d "${TMPDIR:-/tmp}/vibelang-ts-mapper-e2e.XXXXXX")"
if [ "${KEEP:-}" = 1 ]; then echo "e2e: keeping $work"; else trap 'rm -rf "$work"' EXIT; fi
cp -R "$here/fixture/." "$work/"
mkdir -p "$work/node_modules/vibelang-ts-mapper"
cp -R "$package/package.json" "$package/prelude.d.ts" "$package/bin" "$work/node_modules/vibelang-ts-mapper/"
ln -s "$effect_dir" "$work/node_modules/effect"
# The prelude re-exports vibelang-runtime's prelude names, so the runtime's
# declarations sit beside effect. Build them from a copy of the sources whose
# node_modules holds the same effect, without touching packages/runtime.
runtime="$work/node_modules/vibelang-runtime"
mkdir -p "$work/.runtime-build/node_modules" "$runtime"
cp -R "$root/packages/runtime/src" "$root/packages/runtime/tsconfig.json" "$work/.runtime-build/"
# The experimental platform layers (D313) need the optional @effect/platform-*
# packages and Node's types, which this build does not install.
rm -rf "$work/.runtime-build/src/experimental/platform-"* "$work/.runtime-build/src/experimental/internal/node"*
ln -s "$effect_dir" "$work/.runtime-build/node_modules/effect"
"$tsc" -p "$work/.runtime-build/tsconfig.json" --outDir "$runtime/dist" --declarationMap false --sourceMap false --inlineSources false
cp "$root/packages/runtime/package.json" "$runtime/"
echo "$work"

step "cross-file impure recursion stays stack-safe (B)"
node "$here/cross-file-stack.mjs" "$package/bin/vibelang-mapper" "$work"

step "tsc --runExternalCode"
status=0
(cd "$work" && "$tsc" -p . --pretty false --runExternalCode) > "$work/tsc.txt" 2>&1 || status=$?
cat "$work/tsc.txt"
if [ "$status" -ne 2 ]; then echo "e2e: tsc exited $status, expected 2 (errors reported)" >&2; exit 1; fi
if ! diff -u "$here/expected-tsc.txt" "$work/tsc.txt"; then echo "e2e: tsc output differs from expected-tsc.txt" >&2; exit 1; fi
echo "ok   tsc output matches expected-tsc.txt"

step "tsc --lsp --stdio: hover and diagnostics at .vibe positions"
# bin/tsc is a Node launcher; the language server is the native binary it starts.
native="$(node -e 'const r=require("node:module").createRequire(process.argv[1]);const p=`@typescript/typescript-${process.platform}-${process.arch}`;console.log(require("node:path").join(require("node:path").dirname(r.resolve(p+"/package.json")),"lib","tsc"))' "$cache/node_modules/typescript/package.json")"
node "$here/lsp-hover.mjs" "$native" "$work"

step "mapper protocol properties: projections, UTF-8/UTF-16 positions and source maps"
if [ -z "${VIBELANG_BINARY:-}" ]; then
  VIBELANG_BINARY="$work/vibelang"
  (cd "$root/typescript/tsc" && CGO_ENABLED=0 go build -trimpath -gcflags=all=-dwarf=false -o "$VIBELANG_BINARY" ./cmd/tsc)
fi
# Reuse parity's test-only adapter: the production --emit CLI has no tracing option.
node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ Replace: { [process.argv[2]]: process.argv[3] } }))' \
  "$work/emit-overlay.json" "$root/typescript/tsc/cmd/vibelang-mapper/main.go" "$here/parity/emit-main.go"
(cd "$root/typescript/tsc" && CGO_ENABLED=0 go build -overlay "$work/emit-overlay.json" -trimpath -gcflags=all=-dwarf=false -o "$work/emit-options" ./cmd/vibelang-mapper)
(cd "$package" && M1_WORK="$work" M1_MAPPER="$package/bin/vibelang-mapper" M1_STOCK="$native" \
  M1_TRACING_MAPPER="$work/emit-options" VIBELANG_BINARY="$VIBELANG_BINARY" node --test "$here/protocol.property.test.mjs")

step "a .vibe file emitted as .js: stock tsc, vibelang-mapper --emit, node"
# Inside $work, so the project resolves this package, effect and the runtime
# from $work/node_modules.
emit="$work/emit"
mkdir -p "$emit"
cp -R "$here/emit-fixture/." "$emit/"
(cd "$emit" && "$tsc" -p . --pretty false --runExternalCode)
if ! grep -q 'from "./hello.js"' "$emit/out/main.js"; then
  cat "$emit/out/main.js"; echo "e2e: main.js does not import ./hello.js; outputExtensions had no effect" >&2; exit 1
fi
if [ ! -f "$emit/out/hello.d.ts" ]; then
  ls "$emit/out"; echo "e2e: tsc wrote no hello.d.ts; outputExtensions had no effect" >&2; exit 1
fi
"$package/bin/vibelang-mapper" --emit "$emit/src/hello.vibe" --out "$emit/out/hello.js"
ran="$(node "$emit/out/main.js")"
if [ "$ran" != "Hello, Ada!" ]; then echo "e2e: node out/main.js printed: $ran" >&2; exit 1; fi
echo "ok   main.js imports ./hello.js, tsc wrote hello.d.ts, and node prints Hello, Ada!"

step "the prelude sentinel: no effect beside the prelude fails at line 1"
# skipLibCheck hides prelude.d.ts's own failed imports, which would turn every
# helper into the error type; the sentinel on each file's first line names the fix.
# A directory of its own: inside $work, resolution would find $work/node_modules/effect.
bare="$(mktemp -d "${TMPDIR:-/tmp}/vibelang-ts-mapper-no-effect.XXXXXX")"
if [ "${KEEP:-}" = 1 ]; then echo "e2e: keeping $bare"; else trap 'rm -rf "$work" "$bare"' EXIT; fi
mkdir -p "$bare/src" "$bare/node_modules/vibelang-ts-mapper"
cp "$here/fixture/tsconfig.json" "$here/fixture/package.json" "$bare/"
cp "$here/fixture/src/greet.vibe" "$bare/src/"
cp -R "$package/package.json" "$package/prelude.d.ts" "$package/bin" "$bare/node_modules/vibelang-ts-mapper/"
(cd "$bare" && "$tsc" -p . --pretty false --runExternalCode) > "$bare/tsc.txt" 2>&1 || true
if ! grep -q '^src/greet.vibe(1,[0-9]*): error TS1360: .*the prelude cannot resolve effect from its own location; install effect 4.1.0 beside vibelang-ts-mapper' "$bare/tsc.txt"; then
  cat "$bare/tsc.txt"; echo "e2e: the prelude sentinel did not report a missing effect at line 1" >&2; exit 1
fi
echo "ok   TS1360 at greet.vibe line 1 names the fix"

step "e2e: all checks passed"

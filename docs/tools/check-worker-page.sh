#!/bin/sh
# Builds and runs the Cloudflare Workers page's project from the page's own
# code blocks: this checkout's compiler, runtime and vibelang-unplugin, with
# esbuild 0.28.2 and wrangler 4.152.0 from npm. It serves the Worker with
# `wrangler dev` and compares each `curl` answer with the comment after it.
#   sh docs/tools/check-worker-page.sh
# Build the compiler (sh scripts/build-vibelang.sh) and the runtime
# (bun run build in packages/runtime) first. KEEP=1 keeps the project.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
page="$root/docs/user/src/platform/cloudflare-workers.md"
VIBELANG_BINARY=${VIBELANG_BINARY:-$root/packages/compiler/native/vibelang}
export VIBELANG_BINARY WRANGLER_SEND_METRICS=false
[ -x "$VIBELANG_BINARY" ] || { echo "check-worker-page: no compiler at $VIBELANG_BINARY" >&2; exit 2; }
[ -d "$root/packages/runtime/dist" ] || { echo "check-worker-page: build packages/runtime first" >&2; exit 2; }
dir=$(mktemp -d "${TMPDIR:-/tmp}/worker-page.XXXXXX")
group=
cleanup() {
  [ -z "$group" ] || kill -- "-$group" 2>/dev/null || true
  [ "${KEEP:-}" = 1 ] && echo "check-worker-page: kept $dir" || rm -rf "$dir"
}
trap cleanup EXIT
# The json block is tsconfig.json and the toml block wrangler.toml; every
# other file block names its file on its first line.
node --input-type=module - "$page" "$dir" <<'EOF'
const [page, dir] = process.argv.slice(2)
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs")
const { dirname, join } = await import("node:path")
for (const [, info, body] of readFileSync(page, "utf8").matchAll(/```(\w+)[^\n]*\n([\s\S]*?)```/g)) {
  const name = /^\/\/ ([\w./-]+\.(?:vibe|ts|mjs))\n/.exec(body)?.[1] ?? { json: "tsconfig.json", toml: "wrangler.toml" }[info]
  if (!name) continue
  mkdirSync(dirname(join(dir, name)), { recursive: true })
  writeFileSync(join(dir, name), body)
}
EOF
for package in runtime unplugin compiler; do
  (cd "$root/packages/$package" && npm pack --silent --pack-destination "$dir" >/dev/null)
done
cd "$dir"
echo '{ "name": "greeter", "private": true, "type": "module" }' > package.json
npm install --silent --no-audit --no-fund effect@4.1.0 ./vibelang-runtime-*.tgz
npm install --silent --no-audit --no-fund -D ./vibelang-0*.tgz ./vibelang-unplugin-*.tgz esbuild@0.28.2 wrangler@4.152.0
port=${PORT:-8787}
setsid npx wrangler dev --port "$port" --ip 127.0.0.1 > dev.log 2>&1 &
group=$!
tries=0
until curl -sf "http://127.0.0.1:$port/" >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -lt 120 ] || { cat dev.log; echo "check-worker-page: wrangler dev did not start" >&2; exit 1; }
  sleep 1
done
# Each `curl "URL"` line in the page's sh blocks, then its `# answer` line.
node -e '
const text = require("fs").readFileSync(process.argv[1], "utf8")
for (const [, url, answer] of text.matchAll(/^curl "([^"]+)"\n# (.*)$/gm)) console.log(url.replace(":8787", ":" + process.argv[2]) + "\t" + answer)
' "$page" "$port" > expected.tsv
[ -s expected.tsv ] || { echo "check-worker-page: the page has no curl examples" >&2; exit 1; }
failed=0
while IFS="$(printf '\t')" read -r url want; do
  got=$(curl -s "$url")
  if [ "$got" = "$want" ]; then echo "ok   $url -> $got"; else echo "FAIL $url -> $got (want $want)"; failed=1; fi
done < expected.tsv
exit $failed

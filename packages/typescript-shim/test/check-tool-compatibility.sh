#!/bin/sh
set -eu
# Live compatibility check for issue #5. Uses the configured npm registry.
# Run with sh packages/typescript-shim/test/check-tool-compatibility.sh.
shim=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cd "$scratch"
archive=$(npm pack "$shim" --silent)
mkdir project && cd project
printf '{"name":"mixed","private":true,"type":"module","devDependencies":{"typescript":"file:../%s"}}\n' "$archive" >package.json
npm install --no-audit --no-fund --legacy-peer-deps \
  tsup@9.0.0 tsdown@0.23.7 ts-loader@9.6.2 webpack@5.113.0 webpack-cli@7 \
  fork-ts-checker-webpack-plugin@9.2.0 ajv@8 eslint@10.15.0 typescript-eslint@8.74.0 \
  typedoc@0.28.20 vue-tsc@3.3.14 svelte-check@4.7.8 svelte@5 knip@6 \
  jest@29 ts-jest@29.4.15 @types/jest@29 effect@4.1.1 vibelang-runtime@0.0.13
test "$(node -p 'require("typescript/package.json").name')" = vibelang-typescript
cat >tsconfig.json <<'JSON'
{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","types":["jest"],"allowImportingTsExtensions":true,"rewriteRelativeImportExtensions":true,"skipLibCheck":true,"strict":true},"include":["src"]}
JSON
mkdir src
echo 'export effect function label() { return "mixed" }' >src/model.vibe
echo 'export { label } from "./model.vibe"' >src/index.ts
echo 'import { label } from "./index.js"; test("value", () => expect(typeof label).toBe("function"))' >src/index.test.ts
cat >eslint.config.mjs <<'JS'
import tseslint from "typescript-eslint"
export default [{files:["**/*.ts"], languageOptions:{parser:tseslint.parser,parserOptions:{project:"./tsconfig.json"}},plugins:{"@typescript-eslint":tseslint.plugin},rules:{"@typescript-eslint/no-floating-promises":"error"}}]
JS
cat >webpack.config.cjs <<'JS'
module.exports={mode:"development",entry:"./src/index.ts",module:{rules:[{test:/\.ts$/,use:"ts-loader"}]}}
JS
cat >fork.config.cjs <<'JS'
const Plugin=require("fork-ts-checker-webpack-plugin")
module.exports={mode:"development",entry:"./src/index.ts",plugins:[new Plugin()]}
JS
cat >jest.config.cjs <<'JS'
module.exports={transform:{"^.+\\.ts$":"ts-jest"},testEnvironment:"node"}
JS
echo '{"entry":["src/index.ts"],"project":["src/**/*.{ts,vibe}"],"ignoreDependencies":["*"]}' >knip.json
export PATH="$PWD/node_modules/.bin:$PATH"
# Keep going after an incompatible host so each command has its own receipt.
failed=0
probe() {
  tool=$1
  shift
  result=0
  "$@" >"$scratch/$tool.log" 2>&1 || result=$?
  printf '%s exit %s\n' "$tool" "$result"
  if [ "$result" -ne 0 ]; then
    head -c 2000 "$scratch/$tool.log"
    printf '\n'
    failed=1
  fi
}
tsc --noEmit
probe tsup tsup src/index.ts --dts
probe tsdown tsdown src/index.ts --dts
probe ts-loader webpack --config webpack.config.cjs
probe fork-ts-checker-webpack-plugin webpack --config fork.config.cjs
probe typescript-eslint eslint src/index.ts
probe typedoc typedoc src/index.ts
probe vue-tsc vue-tsc --noEmit
probe svelte-check svelte-check --tsconfig ./tsconfig.json
probe knip knip --include unresolved --config knip.json
probe ts-jest jest --runInBand --config jest.config.cjs
exit "$failed"

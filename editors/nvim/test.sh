#!/bin/sh
# Checks editors/nvim/vibelang.lua in a headless Neovim 0.10 or later.
# It copies typescript/vibelang/lsp-fixture to a scratch project that has
# vibelang installed with the compiler under test as its native
# binary, compiles the vibe parser from editors/tree-sitter-vibelang, then
# runs test.lua without the parser and with it.
#
# Usage: editors/nvim/test.sh
#
# Environment:
#   NVIM                   the Neovim binary (default: nvim)
#   VIBELANG                    the vibelang binary (default: ../../typescript/built/local/vibelang)
#   EFFECT_NODE_MODULES    a node_modules directory that holds effect 4.1.0
#                          (default: ../../experiments/node_modules, else
#                          ~/vibelang/experiments/node_modules)
#   VIBELANG_RUNTIME   the built vibelang-runtime package directory
#                          (default: ../../packages/runtime)
#   NVIM_TREESITTER        an nvim-treesitter checkout (master branch), whose
#                          TypeScript queries the vibe queries inherit (default:
#                          lazy.nvim's, when it exists); without one, the checks
#                          of the inherited queries and :TSInstall are skipped
#   CC                     the C compiler (default: cc)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
nvim=${NVIM:-nvim}
vibelang=${VIBELANG:-$repo/typescript/built/local/vibelang}
effect_modules=${EFFECT_NODE_MODULES:-$repo/experiments/node_modules}
[ -d "$effect_modules/effect" ] || effect_modules="$HOME/vibelang/experiments/node_modules"
runtime=${VIBELANG_RUNTIME:-$repo/packages/runtime}
nvim_treesitter=${NVIM_TREESITTER-${XDG_DATA_HOME:-$HOME/.local/share}/nvim/lazy/nvim-treesitter}
[ -d "$nvim_treesitter/lua/nvim-treesitter" ] || nvim_treesitter=
grammar="$repo/editors/tree-sitter-vibelang"

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
project="$scratch/project"
cp -R "$repo/typescript/vibelang/lsp-fixture" "$project"
rm -rf "$project/node_modules"
mkdir -p "$project/node_modules/.bin"
ln -s "$(cd "$effect_modules/effect" && pwd -P)" "$project/node_modules/effect"
ln -s "$(cd "$runtime" && pwd -P)" "$project/node_modules/vibelang-runtime"
# node_modules/.bin/vibelang is vibelang's Node launcher, as bun
# install leaves it, and the launcher runs native/vibelang next to it.
compiler="$project/node_modules/vibelang"
mkdir -p "$compiler/bin" "$compiler/native"
cp "$repo/packages/compiler/package.json" "$compiler/package.json"
cp "$repo/packages/compiler/bin/vibelang" "$compiler/bin/vibelang"
chmod +x "$compiler/bin/vibelang"
ln -s "$vibelang" "$compiler/native/vibelang"
ln -s ../vibelang/bin/vibelang "$project/node_modules/.bin/vibelang"

# The vibe parser, compiled as nvim-treesitter compiles it.
mkdir -p "$scratch/runtime/parser"
"${CC:-cc}" -o "$scratch/runtime/parser/vibe.so" -shared -fPIC -Os -I "$grammar/src" "$grammar/src/parser.c" "$grammar/src/scanner.c"

echo "nvim: $("$nvim" --version | head -1)"
echo "nvim-treesitter: ${nvim_treesitter:-none}"
# Without nvim-treesitter, whose parsers may include vibe.
"$nvim" --headless --clean -l "$here/test.lua" "$project" "$here/vibelang.lua" fallback ""
"$nvim" --headless --clean -l "$here/test.lua" "$project" "$here/vibelang.lua" "$scratch/runtime" "$nvim_treesitter"

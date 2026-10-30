#!/bin/sh
# Creates <dir>/node_modules with the packages the benchmark projects import:
# effect (the runtime's own copy, so one copy loads), vibelang-runtime (this
# checkout's packages/runtime), and the rest from experiments/node_modules and
# docs/tools/node_modules, as docs/tools/check-snippets.ts does.
#
#   sh scripts/bench/modules.sh <dir>
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
dir=$1
modules="$dir/node_modules"
mkdir -p "$modules"
modules=$(CDPATH= cd -- "$modules" && pwd)
[ -f "$root/packages/runtime/dist/index.js" ] || { echo "modules.sh: build packages/runtime first" >&2; exit 1; }
ln -sfn "$(cd "$root/packages/runtime/node_modules/effect" && pwd -P)" "$modules/effect"
ln -sfn "$root/packages/runtime" "$modules/vibelang-runtime"
# Merge scopes package by package: the two installations may share a scope
# while providing different packages within it.
link_missing_packages() {
  for package in "$1"/*; do
    [ -e "$package" ] || continue
    [ -e "$2/${package##*/}" ] || ln -s "$package" "$2/${package##*/}"
  done
}
merge_scope() {
  if [ -L "$2" ]; then
    # Migrate older outputs without writing through their scope symlink.
    # Keep its logical target so input installation aliases still work.
    previous=$(readlink "$2")
    case $previous in /*) ;; *) previous="$modules/$previous" ;; esac
    rm "$2"
    mkdir -p "$2"
    link_missing_packages "$previous" "$2"
  else
    mkdir -p "$2"
  fi
  link_missing_packages "$1" "$2"
}
for source in "$root/experiments/node_modules" "$root/docs/tools/node_modules"; do
  [ -d "$source" ] || continue
  for entry in "$source"/*; do
    [ -e "$entry" ] || continue
    name=${entry##*/}
    case $name in effect|vibelang-runtime|vibelang-vite|.bin) continue ;; esac
    case $name in
      @*) merge_scope "$entry" "$modules/$name" ;;
      *) [ -e "$modules/$name" ] || ln -s "$entry" "$modules/$name" ;;
    esac
  done
done
[ -f "$dir/package.json" ] || echo '{"type":"module","private":true}' > "$dir/package.json"

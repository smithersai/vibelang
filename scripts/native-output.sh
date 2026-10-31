#!/bin/sh
# Publish a native executable only after its writer has closed it. The private
# sibling directory keeps the final rename on the same filesystem, preserves
# the executable suffix, and isolates simultaneous builds (including failures).
# Usage: sh native-output.sh build <output> [go build flags] <package>
#        sh native-output.sh copy <output> <source>
set -eu
operation=$1
output=$2
shift 2
mkdir -p "$(dirname -- "$output")"
directory=$(CDPATH= cd -- "$(dirname -- "$output")" && pwd)
output="$directory/$(basename -- "$output")"
temporary=$(mktemp -d "$directory/.native-output-XXXXXX")
trap 'rm -rf "$temporary"' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
pending="$temporary/$(basename -- "$output")"
case $operation in
  build) go build -o "$pending" "$@" ;;
  copy) cp -p "$@" "$pending" ;;
  *) echo "native-output: unknown operation: $operation" >&2; exit 2 ;;
esac
[ -s "$pending" ] || { echo "native-output: $output: success without a nonempty binary" >&2; exit 1; }
mv -f "$pending" "$output"

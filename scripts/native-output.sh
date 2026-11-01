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
# mv treats a directory (including a directory symlink) as a container,
# which would leave the declared executable path unpublished.
reject_directory() {
  [ ! -d "$output" ] || {
    echo "native-output: $output: output is a directory" >&2
    exit 1
  }
}
reject_directory
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
reject_directory
mv -f "$pending" "$output"

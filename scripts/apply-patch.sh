#!/bin/sh
# apply-patch.sh: apply one queued change to this checkout. Standard input is
# the base64 of its diff, compressed with xz or gzip. xz is 15-45% smaller than
# gzip on large stacks; gzip still applies for older senders.
set -eu
packed=$(mktemp)
patch=$(mktemp)
trap 'rm -f "$packed" "$patch"' 0
base64 -d > "$packed"
if xz -t "$packed" 2>/dev/null; then
	xz -dc "$packed" > "$patch"
else
	gunzip -c "$packed" > "$patch"
fi
git apply --whitespace=nowarn "$patch"

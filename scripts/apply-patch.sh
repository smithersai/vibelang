#!/bin/sh
# apply-patch.sh: apply one queued change to this checkout. Standard input is the base64 of its git diff, compressed
# with xz or gzip. The merge queue's hosted pre-gate (.github/workflows/mq-pregate.yml) runs it on the patch the pool
# dispatches. A repository_dispatch payload holds at most 65,535 characters, and the pool sends xz, which is 15-45%
# smaller than gzip on the queue's large stacks; gzip still applies, for `gh workflow run` and older senders.
set -eu
packed=$(mktemp)
trap 'rm -f "$packed"' 0
base64 -d > "$packed"
if xz -t "$packed" 2>/dev/null; then xz -dc "$packed"; else gunzip -c "$packed"; fi | git apply --whitespace=nowarn -

#!/usr/bin/env bash
# Check that the committed forms table, and the decisions it makes, are
# what the generator and the resolver give today.
#
#   scripts/check-forms-table.sh           regenerate both into a temporary directory; exit 1 on any difference
#   scripts/check-forms-table.sh --write   regenerate forms_table.jsonl and forms_decisions.txt
#
# forms_decisions.txt records what the resolver decides at every lambda,
# block, and by-name argument of the repository's .vibe files
# (typescript/vibelang, examples, templates). --write refuses a decision that
# moved at a site the snapshot already has unless
# forms_decisions_approved.txt names the move, one line each:
#
#   typescript/vibelang/cases/x/main.vibe:12:7 lambda: plain fallback -> effectFn table # why it is right
#
# The table (L1, internal/vibelangmapper/forms.go) is generated from the pinned
# declarations of effect, @effect/*, and vibelang-runtime by cmd/vibelang-forms,
# with the fork's own classifier. It is never edited by hand, so any
# difference means an input changed (a package, the runtime, the classifier)
# or someone edited the file.
#
# Environment:
#   FORMS_NODE_MODULES   effect and @effect/* to read (default docs/tools/node_modules, pinned by docs/tools/bun.lock)
#   FORMS_BINARY       absolute path to a prepared cmd/vibelang-forms executable
#                      (the graph keys it on compiler sources); unset uses go run
#   VIBELANG_FORMS_EXPORT  a file that defines vibelang.FormsOfType, mapped into internal/vibelang with
#                        go build -overlay, for a tree that does not have it yet
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$root/typescript/tsc/internal/vibelangmapper"
table="$dir/forms_table.jsonl"
decisions="$dir/forms_decisions.txt"
approved="$dir/forms_decisions_approved.txt"
write=0
case "${1:-}" in
  --write) write=1 ;;
  "") ;;
  *) echo "usage: scripts/check-forms-table.sh [--write]" >&2; exit 2 ;;
esac

tmp="$(mktemp -d "${TMPDIR:-/tmp}/vibelang-forms.XXXXXX")"
forms_stderr_pid=
cleanup_forms() {
  if [ -n "$forms_stderr_pid" ]; then
    kill "$forms_stderr_pid" 2>/dev/null || true
    wait "$forms_stderr_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup_forms EXIT

if [ -n "${FORMS_BINARY:-}" ]; then
  if [ -n "${VIBELANG_FORMS_EXPORT:-}" ]; then
    echo "check-forms-table: FORMS_BINARY cannot be used with VIBELANG_FORMS_EXPORT; unset it to rebuild with the overlay" >&2
    exit 2
  fi
  if [[ "$FORMS_BINARY" != /* ]] || [ ! -x "$FORMS_BINARY" ] || [ -d "$FORMS_BINARY" ]; then
    echo "check-forms-table: FORMS_BINARY must name an absolute executable file: $FORMS_BINARY" >&2
    exit 2
  fi
fi

overlay=()
if [ -z "${VIBELANG_FORMS_EXPORT:-}" ] && ! grep -qs '^func FormsOfType' "$root"/typescript/tsc/internal/vibelang/*.go; then
  echo "check-forms-table: internal/vibelang does not define FormsOfType, which cmd/vibelang-forms needs; set VIBELANG_FORMS_EXPORT to a file that does" >&2
  exit 1
fi
if [ -n "${VIBELANG_FORMS_EXPORT:-}" ]; then
  printf '{"Replace":{"%s":"%s"}}\n' "$root/typescript/tsc/internal/vibelang/formsexport.go" "$VIBELANG_FORMS_EXPORT" > "$tmp/overlay.json"
  overlay=(-overlay "$tmp/overlay.json")
fi
modules=()
if [ -n "${FORMS_NODE_MODULES:-}" ]; then
  modules=(-node-modules "$FORMS_NODE_MODULES")
fi

gate=()
if [ "$write" = 1 ]; then
  gate=(-previous "$decisions" -approved "$approved")
fi
generator=(go run -trimpath ${overlay[@]+"${overlay[@]}"} ./cmd/vibelang-forms)
if [ -n "${FORMS_BINARY:-}" ]; then
  generator=("$FORMS_BINARY")
fi
run_generator() {
  (cd "$root/typescript/tsc" && CGO_ENABLED=0 "${generator[@]}" -repo "$root" ${modules[@]+"${modules[@]}"} \
    -o "$tmp/forms_table.jsonl" -decisions "$tmp/forms_decisions.txt" ${gate[@]+"${gate[@]}"})
}
if [ -n "${FORMS_BINARY:-}" ]; then
  run_generator
else
  # Keep compiler/admission diagnostics live, and drain the recorder before
  # classifying an error. Closing fd3 lets tee finish even on a silent build.
  exec 3> >(tee "$tmp/generator.stderr" >&2)
  forms_stderr_pid=$!
  if run_generator 2>&3; then generator_status=0; else generator_status=$?; fi
  exec 3>&-
  stderr_status=0
  wait "$forms_stderr_pid" || stderr_status=$?
  forms_stderr_pid=
  if [ "$stderr_status" != 0 ]; then
    echo "check-forms-table: diagnostic recorder failed (exit $stderr_status)" >&2
    exit "$stderr_status"
  fi
  if [ "$generator_status" != 0 ]; then
    # Cache eviction can remove an archive after Go selected it for an import.
    # Retry that compilation once; Go source and generator errors still fail.
    if [ "$generator_status" = 1 ] && grep -Eq 'could not import .* \(open .*/[0-9a-f]{2}/[0-9a-f]{64}-d: no such file or directory\)' "$tmp/generator.stderr"; then
      echo "check-forms-table: compiler cache archive disappeared; retrying generation once" >&2
      rm -f "$tmp/forms_table.jsonl" "$tmp/forms_decisions.txt"
      run_generator
    else
      exit "$generator_status"
    fi
  fi
fi

if [ "$write" = 1 ]; then
  cp "$tmp/forms_table.jsonl" "$table"
  cp "$tmp/forms_decisions.txt" "$decisions"
  echo "check-forms-table: wrote ${table#"$root"/} and ${decisions#"$root"/}"
  exit 0
fi
status=0
if ! cmp -s "$tmp/forms_table.jsonl" "$table"; then
  diff -u "$table" "$tmp/forms_table.jsonl" | head -20 >&2 || true
  echo "check-forms-table: forms_table.jsonl differs from a fresh generation; run scripts/check-forms-table.sh --write" >&2
  status=1
fi
if ! cmp -s "$tmp/forms_decisions.txt" "$decisions"; then
  diff -u "$decisions" "$tmp/forms_decisions.txt" | grep '^[-+][^-+]' | head -20 >&2 || true
  echo "check-forms-table: decisions differ from forms_decisions.txt; run scripts/check-forms-table.sh --write (a moved decision needs a line in forms_decisions_approved.txt)" >&2
  status=1
fi
[ "$status" = 0 ] && echo "check-forms-table: ok, forms_table.jsonl and forms_decisions.txt match a fresh generation"

# D252 checking declarations and runtime dispatch share pinned D152 inputs.
generator="$root/typescript/tsc/cmd/vibelang-data-methods"
[ -d "$generator/node_modules" ] || (cd "$generator" && bun install --frozen-lockfile)
bun "$generator/generate.ts" --check
exit "$status"

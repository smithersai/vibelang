# Compiler gaps in user examples

Run `bun docs/tools/check-snippets.ts` from the repository root. The checker
compiles each page once with the native compiler and checks every marked gap.
A gap that no longer produces an unexpected error or misses its expected
error fails the check until its marker is removed. The checker reports Markdown
line numbers and can write full per-block diagnostics with `--json path`.

This inventory records language/compiler disagreements, not new language rules.
Use the [current specification](../design/src/000-intro.md) and its linked VIPs for rule references. A `// fragment` example
instead omits a fixture or contains an incomplete integration sketch. Type
checking does not prove runtime behavior; the native smoke suite covers that.

## Evidence and scope

Each row identifies the missing contract, resource, producer, or value-call
behavior and the exact diagnostic observed.

## Checked blocks

No checked block has a compiler gap. Record a new one in a table with the
columns page and block, first code line, diagnostic, and rule and
disagreement.

## Editor transport compatibility

`setup/zed.md` was tested with Zed 0.195.3. The configured server starts and
receives `.vibe` documents with language id `typescript`, but Zed sends
`previousResultId: null` in `textDocument/diagnostic`. In that test, the server rejected the request with -32602 (`InvalidParams`).
The field is optional but nonnullable in LSP 3.17; the shared protocol decoder
intentionally rejects null for such fields. A request that omits the field
returns the expected TS2322 diagnostic, and hover requests work. Use
`npx vibelang --noEmit` for diagnostics in that Zed version. This is a transport
compatibility issue, so it has no snippet-level `compiler-gap` marker.

## Runtime disagreements

These examples type-check. A `compiler-gap` header would be stale because the
snippet checker uses that marker for diagnostic disagreements, so the affected
pages state the runtime limitation in prose.

### Timeout discards failures from interrupted cleanup

[Timing out](src/error-management/019-timing-out.md#limiting-execution-duration)
describes the behavior of the pinned Effect release. The timeout operators wait
for interrupted cleanup, including `ensuring` finalizers and scoped releases,
then discard failures from that cleanup.

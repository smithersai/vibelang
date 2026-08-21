# Go compiler scaffold

This module defines the initial transport and extension contracts for the Go
half of VibeLang. It deliberately returns `VIBE0001` / `ErrNotImplemented` for
compilation.

The current TypeScript Go implementation lives under
`github.com/microsoft/TypeScript/tsc/internal/...`. Go's `internal` visibility
rule means VibeLang cannot wrap those parser, checker, emitter, and language
service packages from this root module. The canonical compiler base is
therefore the pinned `smithersai/TypeScript` fork vendored at
`vendor/typescript`; VibeLang's narrow compiler integration must live inside
that fork's `tsc` module. See `docs/TYPESCRIPT_FORK.md` for the import and update
workflow.

`cmd/vibec-go` is a machine-readable placeholder, not the public CLI. The npm
package's `vibe` command owns the Incur interface and `vibec` owns exact raw
TypeScript CLI forwarding.

// Package compiler defines VibeLang's initial Go compiler extension contract.
//
// The current TypeScript compiler keeps its implementation packages under Go's
// internal visibility boundary. VibeLang therefore cannot import and decorate
// those packages from a separate module; production parser/checker/emitter
// integration requires the narrow upstream fork described in the repository
// architecture docs. This package is the stable-facing scaffold for that work.
package compiler

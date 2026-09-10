// Package runtimesources embeds JavaScript-target runtime source for the native
// compiler. It contains no parser, checker, emitter, or compiler-library code.
package runtimesources

import _ "embed"

// Schema is the same validator used by the public JavaScript runtime. Native
// compilation redirects its two runtime imports to the native Result adapter;
// it does not maintain a second implementation of the validator.
//
//go:embed src/build/schema-runtime.ts
var Schema string

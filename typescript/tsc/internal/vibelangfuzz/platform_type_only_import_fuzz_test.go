package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const platformTypeOnlyImportQuote = "`import type { Stats } from \"node:fs\"` is allowed because it is erased."

func TestPlatformTypeOnlyImportQuoted(t *testing.T) { platformTypeOnlyImportQuoted(t) }
func platformTypeOnlyImportQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), platformTypeOnlyImportQuote) {
		t.Fatalf("chapter 5 no longer says %q", platformTypeOnlyImportQuote)
	}
}

var platformTypeOnlyImportSources = map[string]struct {
	source string
	fixes  bool
}{
	"type":      {`import { Store } from "node:async_hooks"; export type C = Store`, true},
	"alias":     {`import { Store as S } from "node:async_hooks"; export type C = S`, true},
	"namespace": {`import * as H from "node:async_hooks"; export type C = H.Store`, true},
	"typeof":    {`import { Store } from "node:async_hooks"; export type C = typeof Store`, true},
	"new":       {`import { Store } from "node:async_hooks"; export const c = new Store()`, false},
	"mixed":     {`import { Store } from "node:async_hooks"; export const c: Store = new Store()`, false},
	"reexport":  {`import { Store } from "node:async_hooks"; export { Store }`, false},
	"shorthand": {`import { Store } from "node:async_hooks"; export const c = { Store }`, false},
}

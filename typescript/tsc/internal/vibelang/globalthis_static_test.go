package vibelang

import (
	"strings"
	"testing"
)

func TestGlobalThisStaticPlatformSpellings(t *testing.T) {
	const source = `export const direct = globalThis.fetch
export const literal = globalThis["fetch"]
export const repeated = globalThis.globalThis.fetch
export const repeatedLiteral = globalThis["globalThis"]["fetch"]
export const timer = globalThis.globalThis.setTimeout
export const pure = globalThis.globalThis.URL
export type FetchType = typeof globalThis.fetch
export type GlobalType = typeof globalThis
export function local(globalThis: { globalThis: { fetch: string } }): string {
  return globalThis.globalThis.fetch
}
`
	p, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() != diagnosticSource || d.Code() != 4402 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
		}
	}
	if count != 5 {
		t.Fatalf("want five platform diagnostics, got %d", count)
	}
}

func TestGlobalThisStaticPlatformLongChain(t *testing.T) {
	source := "export const host = globalThis" + strings.Repeat(".globalThis", 2000) + ".fetch"
	p, file, _, _ := editorProgram(t, source)
	ds := p.GetSemanticDiagnostics(t.Context(), file)
	if len(ds) != 1 || ds[0].Source() != diagnosticSource || ds[0].Code() != 4402 {
		t.Fatalf("want exactly one platform diagnostic for a long global chain, got %v", ds)
	}
}

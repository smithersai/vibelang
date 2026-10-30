package vibelang

import (
	"strings"
	"testing"
)

func TestImportMetaPlatform(t *testing.T) {
	const source = `declare global {
  interface ImportMeta {
    dirname: string
    env: Record<string, string>
    resolve(specifier: string): string
  }
}
export const dirname = import.meta.dirname
export const env = import.meta.env
export const resolve = import.meta.resolve
export const alias = import.meta
export const literal = import.meta["url"]
export const { url } = import.meta
export effect function wrapped() { return try Effect.sync(() => import.meta.dirname) }
export const identity = import.meta.url
export const parens = (import.meta).url
export type Meta = ImportMeta
export class Ordinary { constructor() { new.target.name } }
`
	program, _, _, _ := editorProgram(t, source)
	var spans []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Source() != diagnosticSource || d.Code() != 4402 {
			t.Errorf("unexpected diagnostic: %s", d.String())
			continue
		}
		spans = append(spans, source[d.Pos():d.End()])
		if !strings.Contains(diagnosticWithNotes(d), "move this import.meta use to a .ts file") {
			t.Errorf("diagnostic lacks its repair: %s", d.String())
		}
	}
	if len(spans) != 7 {
		t.Fatalf("want seven EK4402 diagnostics, got %q", spans)
	}
}

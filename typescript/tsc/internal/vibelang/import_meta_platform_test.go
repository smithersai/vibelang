package vibelang

import (
	"testing"
)

// import.meta follows TypeScript: a member the ImportMeta declarations in
// scope provide compiles with its declared type, every use of import.meta
// TypeScript accepts compiles, and an undeclared member is TypeScript's own
// TS2339, never EK4402.
func TestImportMetaPlatform(t *testing.T) {
	const source = `declare global {
  interface ImportMeta {
    dirname: string
    env: Record<string, string>
    resolve(specifier: string): string
    glob<T>(pattern: string, options?: { eager?: boolean; query?: string; import?: string }): Record<string, T>
  }
}
export const dirname: string = import.meta.dirname
export const env = import.meta.env
export const resolve = import.meta.resolve
export const pages: Record<string, string> = import.meta.glob<string>("./*.md", { eager: true, query: "?raw", import: "default" })
export const alias = import.meta
export const literal = import.meta["url"]
export const { url } = import.meta
export effect function wrapped() { return try Effect.sync(() => import.meta.dirname) }
export const identity = import.meta.url
export const parens = (import.meta).url
export type Meta = ImportMeta
export class Ordinary { constructor() { new.target.name } }
export const missing = import.meta.undeclared
`
	program, _, _, _ := editorProgram(t, source)
	var undeclared []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		// rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | An undeclared member is TypeScript's own error, and `EK4402` never reports a declared member.
		if d.Source() != diagnosticSource && d.Code() == 2339 {
			undeclared = append(undeclared, source[d.Pos():d.End()])
			continue
		}
		t.Errorf("unexpected diagnostic: %s", d.String())
	}
	if len(undeclared) != 1 || undeclared[0] != "undeclared" {
		t.Fatalf("want one TS2339 on the undeclared member, got %q", undeclared)
	}
}

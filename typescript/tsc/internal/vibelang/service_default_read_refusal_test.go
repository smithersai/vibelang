package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestServiceDefaultRefusesUnhandledTypeReads(t *testing.T) {
	for _, read := range []string{
		"type K = \"default\"; export type Value = (typeof Flags)[K];",
		"export type Value = (typeof Flags)[(\"default\")];",
		"export type Value = (typeof Flags)[\"default\" | \"key\"];",
		"export type Value = typeof Flags.default.read<string>;",
	} {
		source := "service Flags { static readonly key = \"app/Flags\"; static readonly default: Flags.Shape = { enabled: true, read: <T>(x: T) => x }; enabled: boolean; read: <T>(x: T) => T }\n" + read
		p, file, _, _ := editorProgram(t, source)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("invalid fixture: %s", d.String())
			}
		}
		c, done := p.GetTypeCheckerForFile(t.Context(), file)
		found := false
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if legacyDefault(n) {
				found = true
				r := legacyDefaultRewrite(c, file, n)
				if r.fixable() {
					t.Errorf("unsafe repair with unhandled read %s", read)
				}
				return true
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		done()
		if !found {
			t.Fatal("service fixture not recognized")
		}
	}
}

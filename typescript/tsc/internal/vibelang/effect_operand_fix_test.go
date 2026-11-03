package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestEffectOperandLegacyFix(t *testing.T) {
	for _, test := range []struct {
		name, source, want string
		code               int32
	}{
		{"optional call", "declare const make: (() => Effect.Effect<number>) | undefined; effect function probe() { return try make?.() }", "try (make?.() ?? effect { return undefined })", 502},
		{"computed catch", "effect function probe(input: Effect.Effect<number,string>) { return (try input).toString() catch (e) => e }", "effect { return (try input).toString() } catch", 506},
		{"catch result", "effect function probe() { return try (Effect.fail(\"bad\") catch (() => 0)) }", "(Effect.fail(\"bad\") catch (() => 0))", 502},
		{"unknown call", "declare function make(): unknown; effect function probe() { return try make() }", "try (make() as unknown!!)", 502},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := applyQuickFixOf(t, test.source, test.code, diagnostics.CategoryError)
			if !strings.Contains(got, test.want) {
				t.Fatalf("want %s, got %s", test.want, got)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("repair reports %s%d: %s", d.Source(), d.Code(), d.MessageText())
				}
			}
			if test.name == "unknown call" {
				c, done := program.GetTypeCheckerForFile(t.Context(), file)
				defer done()
				for _, statement := range file.Statements.Nodes {
					if !ast.IsFunctionDeclaration(statement) || statement.Name() == nil || statement.Name().Text() != "probe" {
						continue
					}
					signature := c.GetSignaturesOfType(c.GetTypeAtLocation(statement.Name()), checker.SignatureKindCall)[0]
					returned := c.GetReturnTypeOfSignature(signature)
					for _, channel := range []string{"_E", "_R"} {
						typ := channelType(c, returned, channel)
						if typ == nil || typ.Flags()&checker.TypeFlagsNever == 0 {
							t.Errorf("legacy %s contract widened: %s", channel, c.TypeToString(returned))
						}
					}
				}
			}

		})
	}
}

package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Compare resolved result types: a generated import type and a namespace
// import can name the same Effect interface in emitted declarations.
func TestOptionMatchGenericProgramTypes(t *testing.T) {
	for name, source := range map[string]string{
		"inline-returned":  "export function choose(v: Option.Option<number>) { return Option.match(v, {onNone: () => Effect.fail(\"missing\"), onSome: Effect.succeed}) }",
		"inline-tried":     "export effect function choose(v: Option.Option<number>) { return try Option.match(v, {onNone: () => Effect.fail(\"missing\"), onSome: Effect.succeed}) }",
		"factory-returned": "function handlers() { return {onNone: () => Effect.succeed(0), onSome: Effect.succeed} }; export function choose(v: Option.Option<number>) { return Option.match(v, handlers()) }",
		"factory-tried":    "function handlers() { return {onNone: () => Effect.succeed(0), onSome: Effect.succeed} }; export effect function choose(v: Option.Option<number>) { return try Option.match(v, handlers()) }",
	} {
		t.Run(name, func(t *testing.T) {
			resultType := func(text string) string {
				p, file, _, _ := editorProgram(t, text)
				c, done := p.GetTypeCheckerForFile(t.Context(), file)
				defer done()
				for _, statement := range file.Statements.Nodes {
					if statement.Kind == ast.KindFunctionDeclaration && statement.Name() != nil && statement.Name().Text() == "choose" {
						signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(statement), checker.SignatureKindCall)
						if len(signatures) != 1 {
							t.Fatalf("choose signatures: %v", signatures)
						}
						return c.TypeToStringEx(c.GetReturnTypeOfSignature(signatures[0]), nil, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
					}
				}
				t.Fatal("no choose function")
				return ""
			}
			want := resultType(source)
			fixed := applyQuickFix(t, source, EK4839.Code)
			if strings.Contains(fixed, "Option.match(") {
				t.Fatalf("repair missing:\n%s", fixed)
			}
			if got := resultType(fixed); got != want {
				t.Fatalf("result changed: %s -> %s\n%s", want, got, fixed)
			}
		})
	}
}

package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestTryAnyChannelIdentity(t *testing.T) {
	rows := []struct{ key, declarations, operand string }{
		{"stored", "declare const input:any;", "input"},
		{"direct", "declare function input():any;", "input()"},
		{"return-alias", "type Unchecked=any;declare function input():Unchecked;", "input()"},
		{"callable", "declare const input:()=>any;", "input()"},
		{"optional-call", "declare const input:(()=>any)|undefined;", "input?.()"},
		{"method", "declare const input:{load():any};", "input.load()"},
		{"element-call", "declare const input:{load():any};", "input[\"load\"]()"},
		{"parenthesized-callee", "declare function input():any;", "(input)()"},
		{"generic-call", "declare function input<T>():any;", "input<number>()"},
		{"property-value", "declare const input:{value:any};", "input.value"},
		{"conditional-call", "declare const choose:boolean;declare function left():any;declare function right():any;", "(choose ? left : right)()"},
		{"local-factory", "declare const value:any;function input(){return value}", "input()"},
	}
	for _, row := range rows {
		for wrapper := range 3 {
			t.Run(fmt.Sprintf("%s/%d", row.key, wrapper), func(t *testing.T) {
				operand := row.operand
				if wrapper == 1 {
					operand = "(" + operand + ")"
				}
				if wrapper == 2 {
					operand = "(" + operand + " as any)"
				}
				source := row.declarations + "\nexport function native(){return Effect.gen(function*(){return yield* " + operand + "})}\nexport effect function actual(){return try " + operand + "}"
				program, file, _, _ := editorProgram(t, source)
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("unexpected %s%d: %s\n%s", d.Source(), d.Code(), d.MessageText(), source)
					}
				}
				c, done := program.GetTypeCheckerForFile(t.Context(), file)
				defer done()
				returns := map[string]*checker.Type{}
				for _, statement := range file.Statements.Nodes {
					if ast.IsFunctionDeclaration(statement) && statement.Name() != nil && (statement.Name().Text() == "actual" || statement.Name().Text() == "native") {
						sig := c.GetSignaturesOfType(c.GetTypeAtLocation(statement.Name()), checker.SignatureKindCall)[0]
						returns[statement.Name().Text()] = c.GetReturnTypeOfSignature(sig)
					}
				}
				native, actual := returns["native"], returns["actual"]
				if native == nil || actual == nil {
					t.Fatal("missing function return types")
				}
				for _, name := range []string{"_E", "_R"} {
					reference := channelType(c, native, name)
					if reference == nil || reference.Flags()&checker.TypeFlagsUnknown == 0 {
						t.Fatalf("native %s is not unknown: %s", name, c.TypeToString(native))
					}
					got := channelType(c, actual, name)
					if got == nil || got.Flags()&checker.TypeFlagsUnknown == 0 {
						t.Fatalf("channels do not match native yield*: %s actual=%s native=%s\n%s", name, c.TypeToString(actual), c.TypeToString(native), source)
					}
				}
				if !c.IsTypeAssignableTo(actual, native) || !c.IsTypeAssignableTo(native, actual) {
					t.Fatalf("return types are not mutually assignable: actual=%s native=%s", c.TypeToString(actual), c.TypeToString(native))
				}
			})
		}
	}
}

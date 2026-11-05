package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func joinExecutionRecipe(d *ast.Diagnostic) string {
	for _, child := range d.MessageChain() {
		if i := strings.Index(child.MessageText(), "try "); i >= 0 {
			return strings.TrimSuffix(strings.TrimSpace(child.MessageText()[i:]), ".")
		}
	}
	return ""
}

// Validate the expression actually printed by the diagnostic, including its
// inferred public channels, rather than hard-coding a replacement hint.
func TestJoinOperandExecutionGuidance(t *testing.T) {
	rows := []struct{ key, typ, native string }{
		{"deferred", "Deferred.Deferred<number,string>", "Deferred.await(OPERAND)"},
		{"deferred-never", "Deferred.Deferred<number>", "Deferred.await(OPERAND)"},
		{"promise", "Promise<number>", "Effect.tryPromise(() => OPERAND)"},
		{"thenable", "PromiseLike<number>", "Effect.tryPromise(() => OPERAND)"},
		{"effect", "Effect.Effect<number,string>", "OPERAND"},
		{"effect-subtype", "Effect.Effect<number,string>&{readonly brand:true}", "OPERAND"},
		{"config", "Config.Config<number>", "OPERAND"},
		{"exit", "Exit.Exit<number,string>", "OPERAND"},
		{"deferred-marker", "{readonly \"~effect/Deferred\":unknown}", ""},
		{"effect-marker", "{readonly \"~effect/Effect\":unknown}", ""},
	}
	for _, row := range rows {
		for shape := range 4 {
			t.Run(fmt.Sprintf("%s/%d", row.key, shape), func(t *testing.T) {
				operand := []string{"input", "(/* café 😀 */ input)", "(input satisfies unknown)", "pick()"}[shape]
				prefix := "import {Deferred,Effect,Config,Exit} from \"effect\";declare const input:" + row.typ + ";function pick(){return input}\n"
				program, file, _, _ := editorProgram(t, prefix+"export effect function actual(){return join "+operand+"}")
				var diagnostic *ast.Diagnostic
				promiseCall := shape == 3 && (row.key == "promise" || row.key == "thenable")
				foundPromiseCall := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Code() == EK1704.Code {
						diagnostic = d
					} else if d.Code() == EK0404.Code && promiseCall {
						foundPromiseCall = true
					} else if d.Category() == diagnostics.CategoryError {
						t.Fatalf("invalid control: %s", d.String())
					}
				}
				if promiseCall != foundPromiseCall {
					t.Fatal("independent Promise-call diagnostic changed")
				}
				if diagnostic == nil {
					t.Fatal("missing join operand diagnostic")
				}
				recipe := joinExecutionRecipe(diagnostic)
				if row.native == "" {
					if recipe != "" {
						t.Fatalf("invented a runnable handle from an incomplete marker: %s", recipe)
					}
					return
				}
				if recipe == "" {
					t.Fatalf("no executable recipe:\n%s", diagnosticWithNotes(diagnostic))
				}
				expected := strings.ReplaceAll(row.native, "OPERAND", operand)
				source := prefix + "export effect function actual(){return " + recipe + "}\n" +
					"export function native(){return Effect.gen(function*(){return yield* " + expected + "})}\n" +
					"const forward:typeof native=actual;const backward:typeof actual=native;void forward;void backward;"
				fixed, f, _, _ := editorProgram(t, source)
				for _, d := range fixed.GetSemanticDiagnostics(t.Context(), f) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("printed recipe fails native API identity: %s\n%s", d.String(), source)
					}
				}
			})
		}
	}
}

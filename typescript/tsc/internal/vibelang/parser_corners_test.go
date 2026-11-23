package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// A private-name brand check reads no value from #x, so a do expression on
// the right does not spill #x into a constant (TS1451, invalid JavaScript).
func TestPrivateNameInDoExpression(t *testing.T) {
	program, file, _, _ := editorProgram(t, "export class C {\n  #x = 1\n  static has(o: object): boolean { return #x in do { o } }\n}\n")
	all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
	for _, d := range all {
		t.Errorf("unexpected diagnostic: %s", d.String())
	}
	for _, js := range emittedJS(t, program) {
		if strings.Contains(js, "= #x") {
			t.Fatalf("#x read into a constant:\n%s", js)
		}
		if !strings.Contains(js, "#x in $do") {
			t.Fatalf("brand check lost:\n%s", js)
		}
	}
}

// Appendix A, EffectOperand: after an Effect type in an assertion, a ? before
// the start of an expression is the conditional's, whatever that start is.
func TestConditionalAfterEffectAssertion(t *testing.T) {
	for _, source := range []string{
		"declare const x: unknown\nexport const r = x as number!string ? 1 : 2\n",
		"declare const x: unknown\nexport const r = x as number!string ? +1 : 2\n",
		"declare const x: unknown\nexport const r = x as number!string ? ~1 : 2\n",
		"declare let n: number\ndeclare const x: unknown\nexport const r = x as number!string ? ++n : 2\n",
		"declare const x: unknown\nexport const r = x as number!string ? /a/ : 2\n",
		"declare const x: unknown\nexport const r = x as number!string ? function () {} : 2\n",
		"declare const x: unknown\nexport effect function f() { return x as number!string ? try Effect.succeed(1) : 2 }\n",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
			if got, want := len(file.Statements.Nodes), strings.Count(source, "\n"); got != want {
				t.Fatalf("%d statements, want %d", got, want)
			}
		})
	}
	// In a tuple the ? stays the optional element's.
	program, file, _, _ := editorProgram(t, "export type T = [number!string?, string!!?]\n")
	for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
		t.Errorf("unexpected diagnostic: %s", d.String())
	}
	elements := file.Statements.Nodes[0].Type().AsTupleTypeNode().Elements.Nodes
	for _, element := range elements {
		if element.Kind != ast.KindOptionalType {
			t.Errorf("tuple element is %v, want an optional element", element.Kind)
		}
	}
}

// Appendix A, Declarations: a member gets one diagnostic. Two nameless
// members of a schema body give EK1505 each and nothing about the object
// literal the parser writes for the body.
func TestNamelessSchemaMembers(t *testing.T) {
	for _, test := range []struct {
		source string
		want   int
	}{
		{"export schema S { [k: string]: number; (x: number): string }\n", 2},
		{"export schema S { [k: string]: number; \"#1\": number; (x: number): string; new (): object }\n", 3},
	} {
		source, want := test.source, test.want
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			var others []string
			got := 0
			for _, d := range all {
				if d.Code() == EK1505.Code {
					got++
				} else {
					others = append(others, d.String())
				}
			}
			if got != want || len(others) != 0 {
				t.Fatalf("got %d EK1505 (want %d) and %v", got, want, others)
			}
		})
	}
}

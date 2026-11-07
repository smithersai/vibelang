package vibelang

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// whileNestedConditions bind v below the && chain of a while condition.
var whileNestedConditions = map[string]string{
	"or":        "n < 3 && (n++ === 1 || (n is let v))",
	"not":       "!(n++ > 2 || !(n is let v))",
	"ternary":   "(n++ is let v) ? v < 3 : false",
	"argument":  "n < 3 && keep(n++ is let v)",
	"nested-or": "n < 3 && (false || (false || (n++ is const v)))",
	"mixed":     "(n is let w) && w < 3 && (false || (n++ is let v))",
}

func errorCodes(errors []*ast.Diagnostic) []int32 {
	var codes []int32
	for _, d := range errors {
		codes = append(codes, d.Code())
	}
	return codes
}

// Chapter 004, Pattern bindings: lexical is bindings in a while condition have
// the loop-head home wherever the condition holds them, not only in a
// top-level conjunct, so none of these reports the interim EK4703.
func TestWhileNestedIsBindingHome(t *testing.T) {
	for name, condition := range whileNestedConditions {
		t.Run(name, func(t *testing.T) {
			source := "declare function keep(flag: boolean): boolean\n" +
				"export function f() { let n = 0; const reads: Array<() => number> = []\n" +
				"  while (" + condition + ") { reads.push(() => v) }\n" +
				"  while (" + condition + ") { reads.push(() => v) }\n" +
				"  return reads }\n"
			if errors := errorsOf(t, source); len(errors) != 0 {
				t.Errorf("a nested while-condition binding lost its loop home: %v\n%s", errorCodes(errors), source)
			}
		})
	}
}

// The loop head shadows outer names and does not leak: a read after the loop
// is TS2304, and a direct body read that the condition may skip is TS2454.
func TestWhileNestedIsBindingScope(t *testing.T) {
	for _, test := range []struct {
		name, body string
		want       []int32
	}{
		{"leak", "while (n < 3 && (false || (n++ is let v))) {}\n  return v", []int32{2304}},
		{"skipped", "while (true || (n is const v)) { return v }\n  return 0", []int32{2454}},
		{"assigned", "while (n < 3 && (false || (n++ is let v))) { v += 1 }\n  return n", nil},
		{"shadow", "const v = \"outer\"\n  while (n < 3 && (false || (n++ is let v))) { v satisfies number }\n  return v satisfies string", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "export function f() { let n = 0\n  " + test.body + " }\n"
			if codes := errorCodes(errorsOf(t, source)); !slices.Equal(codes, test.want) {
				t.Errorf("got %v, want %v\n%s", codes, test.want, source)
			}
		})
	}
}

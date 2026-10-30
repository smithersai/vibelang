package parser_test

import "testing"

func TestEffectErrorObjectOperand(t *testing.T) {
	for _, source := range []string{
		"type T = number!{ x: 1 }",
		"type T = number!{}",
		"type T = number!{ x: 1 }!never",
		"function f(): number!! { return 1 }",
		"function f(): number!{ x: 1 } { return 1 }",
		"function f(): number!{ x: 1 }! { return 1 }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("unexpected diagnostic: %v", ds[0].String())
			}
			if len(file.Statements.Nodes) != 1 {
				t.Fatalf("lost type or function body: %d statements", len(file.Statements.Nodes))
			}
		})
	}
}

package vibelang

import "testing"

// VIP-7's invalid pattern grammar remains an error even when the bindings
// have no supported lexical home. Placement is a separate rejection.
func TestUnhomedPatternGrammar(t *testing.T) {
	for _, body := range []string{
		"for (var i=0; xs is [let first, ... ...]; i++) {}",
		"for (var i=0; xs is [let first, ... ...let rest]; i++) {}",
		"for (var i=0; xs is [let first, ..., 1]; i++) {}",
		"for (using r=f(); xs is [let first, ..., 1];) {}",
		"for (var i=0;; xs is [let first, ..., 1]) {}",
		"function g(a=xs is [let first, ..., 1]) {}",
		"switch (0) { case xs is [let first, ..., 1]: }",
		"enum E { A=xs is [let first, ..., 1] }",
		"class C { [xs is [let first, ..., 1]]() {} }",
		"class C extends (xs is [let first, ..., 1]) {}",
		"export default xs is [let first, ..., 1];",
		"for (var i=0; xs is { a: let first, b: }; i++) {}",
		"for (var i=0; xs is [let first, > f()]; i++) {}",
		"for (var i=0; xs is F(let first, ..., 1); i++) {}",
	} {
		t.Run(body, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, "declare const xs: unknown; declare function f(): any;\n"+body+"\nexport {}")
			grammar, placement := 0, 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				if d.Source() != "EK" {
					continue
				}
				if d.Code() == 707 {
					grammar++
				}
				if d.Code() == 4703 || d.Code() == 705 {
					placement++
				}
			}
			if grammar == 0 || placement == 0 {
				t.Fatalf("grammar=%d placement=%d: %s", grammar, placement, body)
			}
		})
	}
}

func TestUnhomedPatternGrammarDoesNotDuplicateHomedErrors(t *testing.T) {
	counts := make(map[string]int)
	for _, kind := range []string{"var", "let"} {
		p, f, _, _ := editorProgram(t, "declare const xs: unknown;\nfor ("+kind+" i=0; xs is [let first, ... ...]; i++) {}\nexport {}")
		for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
			if d.Source() == "EK" && d.Code() == 707 {
				counts[kind]++
			}
		}
	}
	if counts["let"] != 2 || counts["var"] != counts["let"] {
		t.Fatalf("pattern error counts: %v", counts)
	}
}

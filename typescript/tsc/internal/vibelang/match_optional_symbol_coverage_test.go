package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestMatchOptionalSymbolCoverage(t *testing.T) {
	for _, tc := range []struct {
		name, prefix, domain, arms string
		missing                    bool
	}{
		{"symbol-complete", "declare const A: unique symbol; declare const B: unique symbol;", "{_tag:typeof A|typeof B}", "when {_tag:A}:1;when {_tag:B}:2;", false},
		{"symbol-missing", "declare const A: unique symbol; declare const B: unique symbol;", "{_tag:typeof A|typeof B}", "when {_tag:A}:1;", true},
		{"optional-symbol-absent", "declare const A: unique symbol;", "{_tag?:typeof A}", "when {_tag:A}:1;when {_tag:undefined}:2;", true},
		{"optional-symbol-capture", "declare const A: unique symbol;", "{_tag?:typeof A}", "when {_tag:A}:1;when let rest:2;", false},
		{"required-symbol-undefined", "declare const A: unique symbol;", "{_tag:typeof A|undefined}", "when {_tag:A}:1;when {_tag:undefined}:2;", false},
		{"optional-symbol-payload", "declare const A: unique symbol;", "{_tag:typeof A;value?:number}", "when {_tag:A,let value}:1;", true},
		{"required-symbol-payload", "declare const A: unique symbol;", "{_tag:typeof A;value:number}", "when {_tag:A,let value}:1;", false},
		{"symbol-discriminant", "declare const A: unique symbol; declare const B: unique symbol;", "{kind:typeof A|typeof B}", "when {kind:A}:1;when {kind:B}:2;", false},
		{"optional-symbol-discriminant", "declare const A: unique symbol;", "{kind?:typeof A}", "when {kind:A}:1;when {kind:undefined}:2;", true},
		{"untested-optional-symbol", "declare const A: unique symbol;", "{value:number;kind?:typeof A}", "when {value:1}:1;", false},
		{"shared-symbol-required-payload", "declare const A: unique symbol;", "{_tag:typeof A;x:number}|{_tag:typeof A;y:number}", "when {_tag:A,let x}:1;when {_tag:A,let y}:2;", false},
		{"shared-symbol-optional-payload", "declare const A: unique symbol;", "{_tag:typeof A;x?:number}|{_tag:typeof A;y?:number}", "when {_tag:A,let x}:1;when {_tag:A,let y}:2;", true},
	} {
		for _, generic := range []bool{false, true} {
			name := tc.name
			domain := tc.domain
			params := ""
			if generic {
				name += "-generic"
				params = "<T extends " + domain + ">"
				domain = "T"
			}
			t.Run(name, func(t *testing.T) {
				src := tc.prefix + "export function read" + params + "(subject:" + domain + "){return match(subject){" + tc.arms + "}}"
				p, f, _, _ := editorProgram(t, src)
				got := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Code() == EK4701.Code {
						got++
					} else {
						t.Errorf("unexpected: %s", d.String())
					}
				}
				want := 0
				if tc.missing {
					want = 1
				}
				if got != want {
					t.Errorf("EK4701 count %d, want %d\n%s", got, want, src)
				}
			})
		}
	}
}

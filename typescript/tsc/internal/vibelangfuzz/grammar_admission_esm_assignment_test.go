package vibelangfuzz

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// Campaign176: `export = 1;` reported only TS1203, which the oracle did not
// count. The oracle compiles with module NodeNext, where TypeScript rejects
// an export assignment with that grammar error but admits an import
// assignment, `import x = require("m")` or `import y = N.a`: TypeScript's
// ImportEqualsDeclaration, which VIP-40 forbids only in a module body
// (EK4008). The lab derives it; the compiler accepts it.
func TestGrammarAdmissionImportEquals(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	valid := []string{
		"import x = require ( \"m\" ) ;",
		"import type x = require ( \"m\" ) ;",
		"import y = N . a ;",
		"import y = N . a . b",
		"import x = require ( \"m\" ) ; x ;",
	}
	invalid := []string{
		"import x = ;",
		"import = require ( \"m\" ) ;",
		"import x = 1 ;",
		"import x = require ( ) ;",
		"import x = require ( m ) ;",
	}
	for _, control := range []struct {
		sources []string
		accept  bool
	}{{valid, true}, {invalid, false}} {
		for _, source := range control.sources {
			for _, variant := range []struct {
				name string
				g    *grammarCfg
				mode grammarParseMode
			}{{"TypeScript", lab.ts, grammarParseMode{}}, {"VibeLang", lab.g, grammarParseMode{prose: true, names: true}}} {
				derived := lab.read(variant.g, grammarLexSource(source), variant.mode).count != 0
				if derived != control.accept {
					t.Errorf("%s derivation=%v, want %v: %q", variant.name, derived, control.accept, source)
				}
			}
		}
	}
}

// Each program draws no mismatch: the export assignments through TS1203,
// the import assignments through their derivation.
func TestGrammarAdmissionModuleAssignments(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		source string
		code   int32
	}{
		{"export = 1 ;", 1203},
		{"const x = 1 ; export = x ;", 1203},
		{"import x = require ( \"m\" ) ;", 0},
		{"import y = N . a ;", 0},
		{"import x = require ( ( \"m\" ) ) ; ; import y = N . a ;", 1141},
		{"export default 1 ;", 0},
	} {
		t.Run(c.source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, c.source) {
				t.Fatal("mismatch")
			}
			if c.code == 0 {
				return
			}
			result, err := w.Compile(context.Background(), Single(c.source))
			if err != nil {
				t.Fatal(err)
			}
			var seen []string
			for _, d := range result.Diagnostics {
				seen = append(seen, fmt.Sprintf("%s%d", d.Source(), d.Code()))
				if !IsEK(d) && d.Code() == c.code {
					return
				}
			}
			t.Fatalf("no TS%d: %s", c.code, strings.Join(seen, ", "))
		})
	}
}

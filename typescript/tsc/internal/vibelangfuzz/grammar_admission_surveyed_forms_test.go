package vibelangfuzz

import (
	"context"
	"testing"
)

// Forms TypeScript's grammar admits that the lab derived nowhere, found by
// surveying the compiler cases through the admission oracle: an escaped
// IdentifierName after a dot (`new.t\u0061rget`, `try.a\u006ey`), a phase
// import call (`import.source(x)`, `import.defer(x)`), an ambient binding
// pattern with no initializer (`declare const { a }: T;`) and a parenthesized
// EffectType before `=>` in an arrow's return annotation. The compiler admits
// each (type errors aside), so Appendix A must derive it.
var grammarSurveyedFormSeeds = map[string]bool{
	"escaped-try-any":                          true,
	"escaped-fork-in":                          true,
	"escaped-new-target":                       true,
	"escaped-import-meta":                      true,
	"import-phase-source":                      true,
	"import-phase-defer":                       true,
	"import-phase-source-options":              true,
	"ambient-object-pattern":                   true,
	"ambient-array-pattern":                    true,
	"ambient-export-pattern":                   true,
	"arrow-parenthesized-effect-return":        true,
	"arrow-single-parenthesized-effect-return": true,
}

func TestGrammarAdmissionSurveyedForms(t *testing.T) {
	w := NewWorkspace(t)
	seen := 0
	for _, seed := range grammarAdmissionSeeds {
		if !grammarSurveyedFormSeeds[seed.key] {
			continue
		}
		seen++
		t.Run(seed.key, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(seed.source))
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range result.Diagnostics {
				if grammarAdmissionSyntaxDiagnostic(d) {
					t.Fatalf("admitted form rejected as syntax: %v", d)
				}
			}
			if grammarAdmissionVerdict(t, w, seed.source) {
				t.Fatal("inherited form still reported as an admission gap")
			}
			checkGrammarAdmission(t, w, "admission:"+seed.key, seed.source)
		})
	}
	if seen != len(grammarSurveyedFormSeeds) {
		t.Fatalf("expected %d inherited-form seeds, found %d", len(grammarSurveyedFormSeeds), seen)
	}
}

// A control the lab must keep out: an unknown import phase, which the
// compiler rejects with TS18061.
func TestGrammarAdmissionSurveyedFormControls(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	source := "function x(s: string) { return import.other(s) }"
	if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count != 0 {
		t.Errorf("control derives: %q", source)
	}
}

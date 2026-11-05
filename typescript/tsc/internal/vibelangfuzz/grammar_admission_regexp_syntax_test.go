package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestGrammarAdmissionRegExpSyntaxQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A TypeScript inheritance changed; review native RegExp rejection")
	}
}

var grammarRegExpRejections = []struct {
	key, source string
	code        int32
}{
	{"unknown-flag", "const r = /a/z;", 1499},
	{"duplicate-flag", "const r = /a/gg;", 1500},
	{"conflicting-unicode-flags", "const r = /a/uv;", 1502},
	{"empty-subpattern-modifiers", "const r = /(?-:a)/;", 1504},
	{"incomplete-quantifier", "const r = /a{,2}/u;", 1505},
	{"reversed-quantifier", "const r = /a{2,1}/;", 1506},
	{"missing-atom", "const r = /?a/;", 1507},
	{"unmatched-paren", "n = / ) 2 /\n2\n;", 1508},
	{"subpattern-global-flag", "const r = /(?g:a)/;", 1509},
	{"missing-group-name", "const r = /(?<>a)/;", 1514},
	{"duplicate-group-name", "const r = /(?<a>a)(?<a>b)/;", 1515},
	{"class-bound-range", "const r = /[\\d-a]/u;", 1516},
	{"reversed-class-range", "const r = /[z-a]/;", 1517},
	{"missing-set-operand", "const r = /[a&&]/v;", 1520},
	{"reserved-set-punctuation", "const r = /[!!]/v;", 1522},
	{"unknown-property-name", "const r = /\\p{NoSuch=x}/u;", 1524},
	{"unknown-property-value", "const r = /\\p{Script=NoSuch}/u;", 1526},
	{"empty-property", "const r = /\\p{}/u;", 1527},
	{"multi-character-property", "const r = /\\p{RGI_Emoji}/u;", 1528},
	{"unknown-property", "const r = /\\p{NoSuch}/u;", 1529},
	{"missing-property-braces", "const r = /\\p/u;", 1531},
	{"unknown-named-reference", "const r = /(?<a>a)\\k<b>/u;", 1532},
	{"unknown-reference", "const r = /(a)\\2/u;", 1533},
	{"reference-without-groups", "const r = /\\1/u;", 1534},
	{"invalid-identity-escape", "const r = /\\a/u;", 1535},
	{"octal-class-escape", "const r = /[\\1]/u;", 1536},
	{"decimal-class-escape", "const r = /[\\8]/u;", 1537},
	{"unicode-escape-mode", "const r = /\\u{41}/;", 1538},
}

func TestGrammarAdmissionRegExpSyntaxDiagnostics(t *testing.T) {
	TestGrammarAdmissionRegExpSyntaxQuoted(t)
	for code := int32(1499); code <= 1538; code++ {
		if code == 1501 || code == 1503 {
			continue
		}
		for _, category := range []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion, diagnostics.CategoryMessage} {
			for _, source := range []string{"", "other"} {
				d := ast.NewExternalDiagnostic(nil, core.TextRange{}, source, category, code, "native RegExp syntax")
				want := source == "" && category == diagnostics.CategoryError
				if got := grammarAdmissionSyntaxDiagnostic(d); got != want {
					t.Errorf("native RegExp code=%d source=%q category=%v: rejection=%v, want %v", code, source, category, got, want)
				}
			}
		}
	}
	for _, code := range []int32{1501, 1503, 2304, 2322} {
		d := ast.NewExternalDiagnostic(nil, core.TextRange{}, "", diagnostics.CategoryError, code, "target or type error")
		if grammarAdmissionSyntaxDiagnostic(d) {
			t.Errorf("non-grammar native code %d became syntax rejection", code)
		}
	}
	d := ast.NewExternalDiagnostic(nil, core.TextRange{}, "EK", diagnostics.CategoryError, 1508, "source collision")
	if grammarAdmissionSyntaxDiagnostic(d) {
		t.Fatal("EK1508 inherited native RegExp meaning")
	}
}

func TestGrammarAdmissionRegExpSyntaxRegression(t *testing.T) {
	TestGrammarAdmissionRegExpSyntaxQuoted(t)
	w := NewWorkspace(t)
	for _, tc := range grammarRegExpRejections {
		t.Run(tc.key, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(tc.source))
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, d := range result.Diagnostics {
				if d.Source() == "" && d.Code() == tc.code && d.Category() == diagnostics.CategoryError {
					found = true
					if !grammarAdmissionSyntaxDiagnostic(d) {
						t.Errorf("TS%d rejected native syntax but was not classified", tc.code)
					}
				}
			}
			if !found {
				t.Fatalf("missing native TS%d for %s", tc.code, tc.source)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(tc.source), tc.source)
		})
	}
	t.Run("raw-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:native-regexp-literal\n02Ba"))
		if source != "n = / ) 2 /\n2\n;" {
			t.Fatalf("unmatched-parenthesis mutation drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})
	t.Run("valid-native-control", func(t *testing.T) {
		const source = "const n = 8 / 2; const b = unknownName;"
		if got := grammarAdmissionVerdict(t, w, source); got {
			t.Fatalf("ordinary native name error became a grammar mismatch: %s", source)
		}
	})
}

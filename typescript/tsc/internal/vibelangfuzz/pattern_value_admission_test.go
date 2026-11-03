package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const patternValueAdmissionTarget = "FuzzPatternValueAdmission"
const patternValueAdmissionQuote = "Other return types, and callees with neither signature (`any`, `unknown`, `Function`, non-callable objects), are `EK0702`"

func TestPatternValueAdmissionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), patternValueAdmissionQuote) {
		t.Fatalf("Chapter 004 no longer says %q", patternValueAdmissionQuote)
	}
}

type patternValueAdmissionRule struct {
	key, decl, expr string
	reject          bool
}

var patternValueAdmissionRules = []patternValueAdmissionRule{
	{"unknown-initializer", "const p: unknown = () => true", "p", true},
	{"any-initializer", "const p: any = () => true", "p", true},
	{"function-initializer", "const p: Function = () => true", "p", true},
	{"object-initializer", "const p: object = {}", "p", true},
	{"empty-object", "const p = {}", "p", true},
	{"unknown-property", "declare const holder: { p: unknown }", "holder.p", true},
	{"function-index", "declare const holder: { p: Function }", "holder[\"p\"]", true},
	{"number-result", "const p = (_s: unknown): number => 1", "p", true},
	{"predicate", "const p = (s: unknown): s is string => typeof s === \"string\"", "p", false},
	{"boolean-result", "const p = (_s: unknown): boolean => true", "p", false},
	{"primitive-value", "const p = 1", "p", false},
	{"constructor", "class p {}", "p", false},
}
var patternValueAdmissionForms = []string{"match", "is", "match-extractor", "is-extractor"}

func FuzzPatternValueAdmission(f *testing.F) {
	startShortBudget(f)
	for _, rule := range patternValueAdmissionRules {
		for _, form := range patternValueAdmissionForms {
			// A callable's extractor contract differs from its bare predicate contract.
			if !rule.reject && strings.HasSuffix(form, "extractor") {
				continue
			}
			f.Add(rule.key + "/" + form)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestPatternValueAdmissionQuoted(t)
		if key == "" {
			return
		}
		rule := patternValueAdmissionRules[int(key[0])%len(patternValueAdmissionRules)]
		form := patternValueAdmissionForms[int(key[len(key)-1])%2]
		for _, candidate := range patternValueAdmissionRules {
			for _, candidateForm := range patternValueAdmissionForms {
				if key == candidate.key+"/"+candidateForm {
					rule, form = candidate, candidateForm
				}
			}
		}
		if !rule.reject && strings.HasSuffix(form, "extractor") {
			return
		}
		pattern := rule.expr
		if strings.HasSuffix(form, "extractor") {
			pattern += "(let value)"
		}
		expression := "s is " + pattern
		if strings.HasPrefix(form, "match") {
			expression = "match(s) { when " + pattern + ": 1; default: 0; }"
		}
		source := rule.decl + "\nexport function f(s: unknown) { return " + expression + "; }\n"
		var result *Result
		var err error
		within(t, "compile", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var codes []int32
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Category() == diagnostics.CategoryError {
				codes = append(codes, diagnostic.Code())
			}
		}
		want := "[]"
		if rule.reject {
			want = "[702]"
		}
		if fmt.Sprint(codes) != want {
			Gap(t, patternValueAdmissionTarget, "admission:"+rule.key+"/"+form, "VIP-7: %s; want %s, got %v\n%s", patternValueAdmissionQuote, want, codes, source)
		}
		ExpectPending(t, patternValueAdmissionTarget, specCorpusKey(t))
	})
}

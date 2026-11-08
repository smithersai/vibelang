package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// DataDeclaration takes TypeScript's TypeParameters, whose list needs one
// TypeParameter. A class, an error or a service with `<>` reports TS1098; a
// data declaration reports nothing.
const grammarDataEmptyTypeParametersQuote = `DataDeclaration = DataStart TypeParameters? "{" (Variant (Separator Variant)* Separator?)? "}"`

func TestGrammarAdmissionDataEmptyTypeParametersQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarDataEmptyTypeParametersQuote) {
		t.Fatal("Appendix A DataDeclaration changed; review admission:data-empty-type-parameters")
	}
}

// grammarDataEmptyTypeParameters reports `data Name<>` or `data Name< >`.
func grammarDataEmptyTypeParameters(ts []grammarToken) bool {
	for i := 0; i+2 < len(ts); i++ {
		if ts[i].kind != 'w' || ts[i].text != "data" || ts[i+1].nl || ts[i+1].kind != 'w' {
			continue
		}
		if i > 0 && (ts[i-1].text == "." || ts[i-1].text == "?.") {
			continue
		}
		if ts[i+2].text == "<>" || ts[i+2].text == "<" && i+3 < len(ts) && ts[i+3].text == ">" {
			return true
		}
	}
	return false
}

const grammarDataEmptyTypeParametersWitness = "data D<> { Value { value: number } }"

// The case-seeded campaign wrote this mutation of a data case.
const grammarDataEmptyTypeParametersCampaign = "import { Data } from \"effect\" ;\nexport data as < > { Value { value : A } }"

var grammarDataEmptyTypeParametersGaps = []string{
	grammarDataEmptyTypeParametersWitness,
	grammarDataEmptyTypeParametersCampaign,
	"export data D<> { Value { value: number } }",
	"data as < > { Value { value: A } }",
}

func TestGrammarAdmissionDataEmptyTypeParametersKeys(t *testing.T) {
	for _, source := range grammarDataEmptyTypeParametersGaps {
		if got := grammarAdmissionForm(source); got != "admission:data-empty-type-parameters" {
			t.Errorf("key=%q, want admission:data-empty-type-parameters: %q", got, source)
		}
	}
	for _, source := range []string{
		"data D<A> { Value { value: A } }",
		"class C<> {}",
		"type data<> = 1;",
		"function data<>() {}",
		"const data = 1, D = 2; const b = data < D;",
	} {
		if got := grammarAdmissionForm(source); got == "admission:data-empty-type-parameters" {
			t.Errorf("control keyed as an empty data type parameter list: %q", source)
		}
	}
}

func TestGrammarAdmissionDataEmptyTypeParametersRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarDataEmptyTypeParametersGaps {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range []string{
		"data D<A> { Value { value: A } }",
		"class C<> {}",
		"error E<> { readonly n: number }",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}

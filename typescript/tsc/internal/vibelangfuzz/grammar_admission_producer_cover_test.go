package vibelangfuzz

import (
	"context"
	"slices"
	"strings"
	"testing"
)

// A producer is effect function* (VIP-21). Passed to a native generator API
// such as Effect.gen, it reports EK1002. Independent grammar errors in the
// producer's body must remain visible beside that API diagnostic.
const grammarProducerCoverQuote = `Producer = EffectModifier [no LineTerminator here] "function" "*" Name? TypeParameters? Params ReturnType? Block`

func TestGrammarAdmissionProducerCoverQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarProducerCoverQuote) {
		t.Fatal("Appendix A Producer changed; review admission:producer-cover-grammar")
	}
}

// grammarProducerArgument reports a producer expression written as a call
// argument: effect function* right after "(" or ",".
func grammarProducerArgument(ts []grammarToken) bool {
	for i := 1; i+2 < len(ts); i++ {
		if ts[i].kind == 'w' && ts[i].text == "effect" && ts[i+1].text == "function" && !ts[i+1].nl && ts[i+2].text == "*" &&
			(ts[i-1].text == "(" || ts[i-1].text == ",") {
			return true
		}
	}
	return false
}

const grammarProducerCoverWitness = "import { Effect } from \"effect\"\nconst g = Effect.gen(effect function* () {\nconst\nconst users = 1\n})"

// The case-seeded campaign stacked a producer marker and an empty
// declaration list on a service case.
const grammarProducerCoverCampaign = "class UserNotFound extends TaggedError ( \"UserNotFound\" ) < { readonly id : string } > { }\ninterface User {\nid : string\nname : string\n}\nservice Users {\nfind ( id : string ) : Effect < User , UserNotFound , never >\n}\nconst findName\n= effect ( id : string ) => try Effect . gen ( effect function * ( ) {\nconst\nconst users = try Users\nconst user = try users . find ( id )\nyield user . name\n} )"

var grammarProducerCoverGaps = []string{
	grammarProducerCoverWitness,
	grammarProducerCoverCampaign,
	"import { Effect } from \"effect\"\nconst g = Effect.gen(effect function* () { class C<> {} })",
}

func TestGrammarAdmissionProducerCoverKeys(t *testing.T) {
	for _, source := range grammarProducerCoverGaps {
		if got := grammarAdmissionForm(source); got != "admission:producer-cover-grammar" {
			t.Errorf("key=%q, want admission:producer-cover-grammar: %q", got, source)
		}
	}
	for _, source := range []string{
		"import { Effect } from \"effect\"\nconst g = Effect.gen(function* () {\nconst\nconst users = 1\n})",
		"effect function* p() {\nconst\nconst users = 1\n}",
		"const p = effect function* () {\nconst\nconst users = 1\n}",
	} {
		if got := grammarAdmissionForm(source); got == "admission:producer-cover-grammar" {
			t.Errorf("control keyed as a covered producer argument: %q", source)
		}
	}
}

func TestGrammarAdmissionProducerCoverRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarProducerCoverGaps {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("independent grammar rejection was hidden by the API mismatch")
			}
			r, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			if !slices.Contains(r3Errors(r.Diagnostics), "EK1002") {
				t.Fatalf("missing API diagnostic: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range []string{
		"import { Effect } from \"effect\"\nconst g = Effect.gen(function* () {\nconst\nconst users = 1\n})",
		"effect function* p() {\nconst\nconst users = 1\n}",
		"import { Effect } from \"effect\"\nconst g = Effect.gen(effect function* () { const users = 1; yield users })",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}

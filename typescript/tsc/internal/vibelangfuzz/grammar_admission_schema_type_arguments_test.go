package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

func TestGrammarAdmissionSchemaTypeArgumentsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarSchemaFieldTypeQuote) {
		t.Fatal("Appendix A's Field type production changed; review the type argument list key")
	}
}

// grammarSchemaTypeArgumentList reports a type argument list that ends in a
// comma or holds nothing, inside a schema or schema error declaration.
// TypeScript's TypeArguments is "<" TypeList ">": its checker rejects the
// trailing comma (TS1009) and the empty list (TS1099) on a recovered parse.
// Schema mapping reads the field type first, so a mapped type compiles with
// no diagnostic and any other type reports EK2109 alone. The declaration's
// own type parameter list, straight after its name, is not a field type.
func grammarSchemaTypeArgumentList(ts []grammarToken) bool {
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "schema" || i+1 >= len(ts) || ts[i+1].kind != 'w' || ts[i+1].nl {
			continue
		}
		name := i + 1
		if ts[name].text == "error" && name+1 < len(ts) && ts[name+1].kind == 'w' && !ts[name+1].nl {
			name++
		}
		start := name + 1
		if start >= len(ts) {
			continue
		}
		alias := ts[start].text == "="
		if !alias && ts[start].text != "{" {
			continue
		}
		depth := 0
		for k := start; k < len(ts); k++ {
			switch ts[k].text {
			case "{", "(", "[":
				depth++
			case "}", ")", "]":
				depth--
			}
			if ts[k].text == ">" && k > start+1 && (ts[k-1].text == "," || ts[k-1].text == "<") {
				return true
			}
			if !alias && depth == 0 && ts[k].text == "}" {
				break
			}
			if alias && depth == 0 && k > start && (ts[k].text == ";" || k+1 < len(ts) && ts[k+1].nl) {
				break
			}
		}
	}
	return false
}

const grammarSchemaTypeArgumentsWitness = "schema S { a : Array < string , > }"

// The campaign witness: a case mutation deleted the second type argument.
const grammarSchemaTypeArgumentsCampaign = "schema Probe { readonly value : Option < string > }\nschema Ids { readonly ids : HashSet < string > }\nschema Copies { readonly copies : HashMap < string , > }\nschema Items { readonly items : Chunk < number > }\nschema Bare = Option < string >\nschema error Missing { readonly value : Option < number > }"

var grammarSchemaTypeArgumentsGaps = []string{
	grammarSchemaTypeArgumentsWitness,
	"schema S { a : Missing < > }",
	grammarSchemaTypeArgumentsCampaign,
	"schema S = Array < string , >",
	"schema S { a : Missing < string , > }",
	"schema S = Missing < string , >",
	"schema error E { a : Missing < string , > }",
	"schema S { a : Array < > }",
	"schema S = Missing < >",
	"schema S { a : { b : Missing < string , > } }",
	"schema S { a : Missing < string , > ; b : string }",
}

func TestGrammarAdmissionSchemaTypeArgumentsKeys(t *testing.T) {
	for _, source := range grammarSchemaTypeArgumentsGaps {
		if got := grammarAdmissionForm(source); got != "admission:schema-type-argument-list" {
			t.Errorf("key=%q, want admission:schema-type-argument-list: %q", got, source)
		}
	}
	for _, source := range []string{
		"schema S { a : Array < string > }",
		"schema S { a : Missing < string , number > }",
		"schema S = Array < string >",
		"schema S { a : string }\ntype T = Missing < string , >;",
		"schema S = string\ntype T = Missing < >;",
		"type T = { a : Missing < string , > };",
		"interface I { a : Missing < > }",
		"data D { A { a : Missing < string , > } }",
		"error E { a : Missing < string , > }",
		"service S { a : Missing < string , > }",
		"const schema = f < string , > ( x );",
		"const s = 'schema S { a : Array < string , > }';",
	} {
		if got := grammarAdmissionForm(source); got == "admission:schema-type-argument-list" {
			t.Errorf("control keyed as a schema type argument list: %q", source)
		}
	}
}

func TestGrammarAdmissionSchemaTypeArgumentsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarSchemaTypeArgumentsGaps {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range []string{
		"schema S { a : Array < string > }",
		"type T = { a : Missing < string , > };",
		"interface I { a : Missing < string , > }",
		"type T = Missing < >;",
		"data D { A { a : Missing < string , > } }",
		"error E { a : Missing < string , > }",
		"service S { a : Missing < string , > }",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}

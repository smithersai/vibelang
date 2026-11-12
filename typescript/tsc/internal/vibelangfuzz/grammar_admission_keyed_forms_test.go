package vibelangfuzz

import "testing"

// Three parsed-but-undefined forms the directed batches and a Deep sweep
// exposed, each keyed to a pending admission line owned by the compiler.
//
// `schema S { a: Array.<string> }`: the JSDoc dotted generic maps silently as
// a schema field type (no diagnostic at all), where TypeScript reports TS8020;
// it joins admission:schema-jsdoc-dotted-field-type, whose prefix forms the compiler
// now rejects.
// `schema S { a: asserts x }`: an assertion or this predicate written as a
// field type becomes an unsupported schema type (EK2109 alone) and loses the
// native TS1228 rejection.
// `workflow W { async static readonly maxRounds = 2; … }`: without the
// experimental opt-in a file's first gated use is EK3013 once per file and
// the member checks of VIP-55 never run, so a member shape the parser reads
// but Appendix A does not derive compiles with EK3013 alone.

// grammarSchemaPredicateFieldType reports a schema body field whose written
// type starts with `asserts` Identifier or `this is`.
func grammarSchemaPredicateFieldType(ts []grammarToken) bool {
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "schema" || i+2 >= len(ts) || ts[i+1].kind != 'w' || ts[i+1].nl {
			continue
		}
		open := i + 2
		if ts[i+1].text == "error" && open+1 < len(ts) && ts[open].kind == 'w' && !ts[open].nl {
			open++
		}
		if open >= len(ts) || ts[open].text != "{" {
			continue
		}
		depth := 0
		for k := open; k+2 < len(ts); k++ {
			switch ts[k].text {
			case "{", "[", "(", "<":
				depth++
			case "}", "]", ")", ">":
				depth--
			}
			if depth == 0 {
				break
			}
			if depth != 1 || ts[k].text != ":" {
				continue
			}
			if ts[k+1].text == "asserts" && ts[k+2].kind == 'w' && !ts[k+2].nl {
				return true
			}
			if ts[k+1].text == "this" && ts[k+2].text == "is" && !ts[k+2].nl {
				return true
			}
		}
	}
	return false
}

// grammarExperimentalGatedBody reports a task or workflow declaration: the
// word, a name on the same line and a body.
func grammarExperimentalGatedBody(ts []grammarToken) bool {
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "task" && tok.text != "workflow" || i > 0 && (ts[i-1].text == "." || ts[i-1].text == "?.") {
			continue
		}
		if i+2 < len(ts) && ts[i+1].kind == 'w' && !ts[i+1].nl && ts[i+2].text == "{" {
			return true
		}
	}
	return false
}

func TestGrammarAdmissionKeyedFormsKeys(t *testing.T) {
	for source, want := range map[string]string{
		"schema S { a: Array.<string> }":                  "admission:schema-jsdoc-dotted-field-type",
		"schema S { a: Map.<string, number>; b: string }": "admission:schema-jsdoc-dotted-field-type",
		"schema S = Array.<string>":                       "admission:schema-jsdoc-dotted-field-type",
		"schema S { a: asserts x }":                       "admission:schema-predicate-field-type",
		"schema S { a: asserts this is string }":          "admission:schema-predicate-field-type",
		"schema S { a: this is string }":                  "admission:schema-predicate-field-type",
		"schema error E { a: asserts x }":                 "admission:schema-predicate-field-type",
		"workflow W { async static readonly maxRounds = 2; effect call(repo: string) { return 1 } }": "admission:experimental-gated-body",
		"task T { declare effect call(repo: string): number!string }":                                "admission:experimental-gated-body",
		"export workflow W { get x() { return 1 } effect call(repo: string) { return 1 } }":          "admission:experimental-gated-body",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("key=%q, want %q: %s", got, want, source)
		}
	}
	for _, source := range []string{
		"schema S { a: Array<string> }",
		"schema S { a: string; asserts: number }",
		"schema S { a: string }\nconst v = asserts;",
		"type T = { a: asserts x }",
		"const task = 1; task.run({})",
		"workflow\nW = 1",
		"const o = { workflow: { x: 1 } }",
	} {
		if got := grammarAdmissionForm(source); got == "admission:schema-jsdoc-dotted-field-type" || got == "admission:schema-predicate-field-type" || got == "admission:experimental-gated-body" {
			t.Errorf("control keyed as %q: %s", got, source)
		}
	}
	if _, ok := Pending("FuzzGrammarAdmission", "admission:schema-jsdoc-field-type"); ok {
		t.Error("the fixed JSDoc prefix and postfix key must stay retired")
	}
	for _, key := range []string{"admission:schema-jsdoc-dotted-field-type", "admission:schema-predicate-field-type", "admission:experimental-gated-body"} {
		if _, ok := Pending("FuzzGrammarAdmission", key); !ok {
			t.Errorf("%s has no pending line", key)
		}
	}
}

func TestGrammarAdmissionKeyedFormsRegression(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	w := NewWorkspace(t)
	for _, source := range []string{
		"schema S { a: Array.<string> }",
		"schema S { a: asserts x }",
		"schema S { a: this is string }",
		"workflow W { async static readonly maxRounds = 2; effect call(repo: string) { return 1 } }",
	} {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("keyed form derives: %q", source)
		}
		if grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler now rejects the keyed form as syntax; retire its pending line: %q", source)
		}
		if !grammarAdmissionVerdict(t, w, source) {
			t.Errorf("keyed form lost its observed admission gap: %q", source)
		}
	}
	for _, source := range []string{
		"schema S { a: Array<string> }",
		"workflow W { static readonly maxRounds = 2; effect call(repo: string) { return 1 } }",
	} {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("control has no derivation: %q", source)
		}
	}
}

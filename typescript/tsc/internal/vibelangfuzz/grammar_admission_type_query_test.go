package vibelangfuzz

import "testing"

// TypeScript's parser reads the first name of a type query with reserved
// words allowed (parseTypeQuery calls parseEntityName with
// allowReservedWords), so `typeof try.Type` is a well-formed type whose
// checker error is TS2304, not a syntax error. Only `import` can't start the
// name: `typeof import` is an import type and needs `(`. The lab's
// TypeQueryName took an IdentifierReference, so a reserved word there read
// as an admission mismatch. The campaign mutation that found it is the
// minimized Cases corpus entry type-query-reserved-head.
var grammarTypeQueryReservedHeads = []string{
	"type X = typeof try.Type;",
	"type X = typeof try;",
	"type X = typeof class.Type;",
	"type X = typeof new.target;",
	"type X = typeof return;",
	"type X = typeof null;",
	"type X = typeof true.valueOf;",
	"type X = typeof super.m;",
	"type X = typeof let.x;",
	"type X = typeof static;",
	"type X = typeof yield.x;",
	"type X = typeof this.x;",
	"type X = typeof typeof;",
	"declare const v: typeof try.Type;",
	"function f(x: typeof try.Type) { return x; }",
	"type X = typeof try<number>;",
	"type X = typeof try.Type[];",
	"type X = keyof typeof try.Type;",
	// A type reference's name allows reserved words the same way (TS2503).
	"type X = try.Type;",
}

func TestGrammarAdmissionTypeQueryReservedHead(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarTypeQueryReservedHeads {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("type query with a reserved head has no derivation: %q", source)
		}
		if r := lab.read(lab.ts, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
			t.Errorf("type query with a reserved head has no TypeScript derivation: %q", source)
		}
	}
	for _, source := range []string{
		// `typeof import` is an import type: its argument list is required.
		"type X = typeof import.Type;",
		"type X = typeof import;",
		"type X = typeof try.;",
	} {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("malformed type query has a derivation: %q", source)
		}
	}
}

func TestGrammarAdmissionTypeQueryReservedHeadRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarTypeQueryReservedHeads {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("a reserved type query head reads as an admission gap: %q", source)
		}
	}
	// In effect code `fork` and `join` are reserved by VIP-17 and the compiler
	// still reads them as type-space names; that gap stays keyed under
	// admission:fiber-type-name and is not an inherited reserved word here.
	for _, source := range []string{
		"type X = typeof import.Type;",
		"type X = typeof try.;",
	} {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}

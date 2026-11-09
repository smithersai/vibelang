package vibelangfuzz

import "testing"

// Two rejections the oracle did not count as syntax rejection, found by the
// Deep and Cases campaigns.
//
// TypeScript's parser reads `import . Name` as a MetaProperty whatever the
// name and its checker rejects a name other than meta: TS17012 for
// `import.foo`, TS18061 when the misspelled property is a callee
// (`import.require(x)`), and `'(' expected` (TS1005) for an uncalled
// `import.defer` or `import.source` (checkGrammarMetaProperty). The lab
// derives only `import.meta`, so each form reads as a mismatch unless the
// checker's rejection counts.
//
// VIP-18 retired `await.all`, `await.race`, `await.any` and `await.allSettled`.
// The parser still reads `await . <operation> <operand>` (an operand that is a
// SimpleUnaryExpression, or a parenthesized one followed by call parts) to
// report EK1802 and drive `--fix`; no production admits it, so EK1802 is
// the rejection. The hook is the inventory's `admission:legacy-await` row.
const grammarImportMetaCalleeName = "1\nimport . require ( join\n)"

const grammarRetiredAwaitOperation = "effect function load ( ) : number ! ! {\nreturn 1\n}\nexport effect function retired ( ) {\nreturn await . race 1 [ load ( ) , load ( ) ]\n}"

var grammarRejectedMetaAndAwaitForms = []string{
	grammarImportMetaCalleeName,
	grammarRetiredAwaitOperation,
	"import.require(x);",
	"const m = import.require;",
	"import.defer;",
	"const x = import.source;",
	"const x = import.foo;",
	"effect function f() { return await.race [a, b] }",
	"effect function f() { return await.all 1 [a, b] }",
	"effect function f() { return await.any (xs).length }",
	"effect function f() { return await.allSettled xs }",
	"effect function f() { return await . race\n[a, b] }",
}

func TestGrammarAdmissionRejectedMetaAndAwaitForms(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	// `await.race [a, b]`, `await.any (xs).length` and the line-break form
	// derive as a member expression indexed or called in ordinary TypeScript,
	// which is why the campaign saw the hook only once a `1` stood between
	// the operation and its operand. The others have no derivation.
	derivable := map[string]bool{
		grammarRejectedMetaAndAwaitForms[7]:  true,
		grammarRejectedMetaAndAwaitForms[9]:  true,
		grammarRejectedMetaAndAwaitForms[11]: true,
	}
	for _, source := range grammarRejectedMetaAndAwaitForms {
		derives := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}).count != 0
		if derives != derivable[source] {
			t.Errorf("rejected form derivation=%v, want %v: %q", derives, derivable[source], source)
		}
	}
	w := NewWorkspace(t)
	for _, source := range grammarRejectedMetaAndAwaitForms {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("a rejected meta-property or retired await operation reads as an admission gap: %q", source)
		}
	}
	// The accepted spellings stay derivable and accepted.
	for _, source := range []string{
		"const u = import.meta.url;",
		"effect function f() { return try.race([a, b]) }",
		"effect function f() { return try . all [a, b] }",
	} {
		if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count == 0 {
			t.Errorf("accepted form has no derivation: %q", source)
		}
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}

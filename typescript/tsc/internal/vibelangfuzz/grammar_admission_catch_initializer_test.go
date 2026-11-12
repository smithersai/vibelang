package vibelangfuzz

import "testing"

// TypeScript parses an initializer on a catch clause variable and rejects the
// shape from checkGrammarVariableDeclaration (TS1197, "Catch clause variable
// cannot have an initializer"), and parses a type-only import clause with a
// default and bindings and rejects that shape from checkGrammarImportClause
// (TS1363), and parses any expression as an import attribute value and
// rejects one that is not a string literal from checkGrammarImportAttributes
// (TS2858), as stock TypeScript 5.9.3 does. Appendix A's Catch takes no
// initializer, its ImportClause no such combination and its WithEntry only a
// string literal, so the lab has no derivation; the oracle now counts TS1197,
// TS1363 and TS2858 as syntax rejections, as it counts the other structural
// grammar codes, so the two sides agree. Directed batches found each program
// read as an admission gap before.
var grammarCatchInitializerForms = []string{
	"try {} catch (e = 1) {}",
	"try {} catch ({ a } = {}) {}",
	"try {} catch ([e] = []) {}",
	"import type T, { U } from \"./m\";",
	"import type T, * as ns from \"./m\";",
	"import x from \"./m\" with { type: 1 };",
	"import x from \"./m\" with { type: json };",
	"export * from \"./m\" with { type: 1 };",
	"type A = import(\"./m\", { with: { a: 1 } }).T;",
	"type A = import(\"./m\", { with: { a: `t` } }).T;",
}

var grammarCatchInitializerControls = []string{
	"import x from \"./m\" with { type: \"json\" };",
	"export * from \"./m\" with { type: \"json\" };",
	"import type T from \"./m\";",
	"import type { U } from \"./m\";",
	"import T, { U } from \"./m\";",
	"try {} catch (e) {}",
	"try {} catch (e: unknown) {}",
	"try {} catch ({ message }) {}",
	"try {} catch {}",
}

// TypeScript's checker skips TS1197 when the catch binding carries a type
// annotation: `try {} catch (e: unknown = 1) {}` compiles with no diagnostic
// in the compiler and in stock TypeScript 5.9.3, although Appendix A's Catch
// takes no initializer. That is a compiler-admits-undefined gap inherited
// from TypeScript, recorded as the pending key below; the classifier reads a
// catch parameter with both an annotation and an initializer.
var grammarCatchAnnotatedInitializerForms = []string{
	"try {} catch (e: unknown = 1) {}",
	"try {} catch ({ a }: { a: number } = { a: 1 }) {}",
	"try {} catch (e: any = null) {} finally {}",
}

// grammarCatchAnnotatedInitializer reports a catch parameter that has a type
// annotation and an initializer: a `:` and then a `=` at the parameter's own
// depth between `catch (` and its `)`.
func grammarCatchAnnotatedInitializer(ts []grammarToken) bool {
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "catch" || i+1 >= len(ts) || ts[i+1].text != "(" {
			continue
		}
		depth, annotated := 1, false
		for j := i + 2; j < len(ts); j++ {
			switch ts[j].text {
			case "(", "[", "{", "<":
				depth++
			case ")", "]", "}", ">":
				depth--
			}
			if depth == 0 {
				break
			}
			if depth == 1 && ts[j].text == ":" {
				annotated = true
			}
			if depth == 1 && annotated && ts[j].text == "=" {
				return true
			}
		}
	}
	return false
}

func TestGrammarAdmissionCatchAnnotatedInitializerKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"try {} catch (e: unknown = 1) {}":                   true,
		"try {} catch ({ a }: { a: number } = { a: 1 }) {}":  true,
		"try {} catch (e: any = null) {} finally {}":         true,
		"try {} catch (e = 1) {}":                            false,
		"try {} catch (e: unknown) {}":                       false,
		"try {} catch ({ a = 1 }: { a: number }) {}":         false,
		"function f(e: unknown = 1) { try {} catch (e) {} }": false,
		"const text = \"try {} catch (e: unknown = 1) {}\";": false,
	} {
		if got := grammarAdmissionForm(source); (got == "admission:catch-annotated-initializer") != want {
			t.Errorf("key=%q, want annotated catch initializer=%v: %s", got, want, source)
		}
	}
	if _, ok := Pending("FuzzGrammarAdmission", "admission:catch-annotated-initializer"); !ok {
		t.Fatal("admission:catch-annotated-initializer has no pending line")
	}
}

func TestGrammarAdmissionCatchAnnotatedInitializerRegression(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	w := NewWorkspace(t)
	for _, source := range grammarCatchAnnotatedInitializerForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("annotated catch initializer derives: %q", source)
		}
		if grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler now rejects the annotated catch initializer as syntax; retire the pending key: %q", source)
		}
		if !grammarAdmissionVerdict(t, w, source) {
			t.Errorf("annotated catch initializer lost its observed admission gap: %q", source)
		}
	}
}

func TestGrammarAdmissionCatchInitializer(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarCatchInitializerForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("catch initializer derives: %q", source)
		}
	}
	for _, source := range grammarCatchInitializerControls {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("catch clause has no derivation: %q", source)
		}
	}
}

func TestGrammarAdmissionCatchInitializerRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarCatchInitializerForms {
		if !grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("catch initializer is not a syntax rejection: %q", source)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("catch initializer reads as an admission gap: %q", source)
		}
	}
	for _, source := range grammarCatchInitializerControls {
		if grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler rejects a catch clause as syntax: %q", source)
		}
	}
}

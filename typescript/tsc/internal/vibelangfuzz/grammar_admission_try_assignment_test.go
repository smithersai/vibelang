package vibelangfuzz

import (
	"testing"
)

// Appendix A: TryExpression = [+Effect] "try" UnaryExpression, where
// ECMAScript has AwaitExpression, and an AssignmentExpression's target is a
// LeftHandSideExpression. The compiler rejects `await p = 1` as syntax
// (TS1005) but compiles `try p = 1`, `(try p = 1, 2)` and the try-prefixed
// head of a compiler case with only EK502, so the written form has no
// derivation and no syntax rejection. The classifier keys it; the key is
// pending until the compiler owner decides the rejection.
var grammarTryAssignmentSources = []string{
	"import { Effect } from \"effect\"\nexport effect function f() {\n  let p = 0\n  try p = 1\n  return p\n}\n",
	"import { Effect } from \"effect\"\nexport effect function f() {\n  let p = 0\n  const y = (try p = 1, 2)\n  return y\n}\n",
	"// expect-result: \"ReferenceError\"\nimport { Effect } from \"effect\"\n\nexport effect function main() {\n  let probe: () => unknown = () => 0\n  for concurrent (const x of (try probe = () => x, [1])) {}\n  return try Effect.sync(() => {\n    try { probe(); return \"read\" }\n    catch (e) { return (e as Error).name }\n  })\n}\n",
}

// Shapes the classifier keys without a compiler run: compound operators,
// member targets, a try operation and a line break before the operator.
var grammarTryAssignmentShapes = []string{
	"effect function f(p: number) { try p += 1 }",
	"effect function f(o: { p: number }) { try o.p = 1 }",
	"effect function f(xs: number[]) { try.all xs = xs }",
	"effect function f(p: number) { try p\n= 1 }",
}

var grammarTryAssignmentOperators = map[string]bool{
	"=": true, "+=": true, "-=": true, "*=": true, "/=": true, "%=": true, "**=": true,
	"<<=": true, ">>=": true, ">>>=": true, "&=": true, "|=": true, "^=": true,
	"&&=": true, "||=": true, "??=": true,
}

var grammarTryOperationNames = map[string]bool{"all": true, "race": true, "any": true, "allSettled": true}

// grammarTryAssignmentTarget reports a try expression written as an
// assignment target: `try p = 1`, `try o.p += 1`, `try.all xs = v`.
func grammarTryAssignmentTarget(ts []grammarToken) bool {
	words := make([]grammarToken, 0, len(ts))
	for _, tok := range ts {
		if tok.kind != 't' {
			words = append(words, tok)
		}
	}
	for i, tok := range words {
		if tok.kind != 'w' || tok.text != "try" || (i > 0 && words[i-1].text == ".") {
			continue
		}
		j := i + 1
		if j+1 < len(words) && words[j].text == "." && words[j+1].kind == 'w' && grammarTryOperationNames[words[j+1].text] {
			j += 2
		}
		if j >= len(words) || words[j].kind != 'w' {
			continue
		}
		j++
		for j+1 < len(words) && words[j].text == "." && words[j+1].kind == 'w' {
			j += 2
		}
		if j < len(words) && words[j].kind == 'p' && grammarTryAssignmentOperators[words[j].text] {
			return true
		}
	}
	return false
}

func TestGrammarAdmissionTryAssignmentQuoted(t *testing.T) {
	chapterSays(t, grammarAppendix, "TryExpression = [+Effect] \"try\" UnaryExpression")
}

func TestGrammarAdmissionTryAssignmentKeys(t *testing.T) {
	for _, source := range append(append([]string(nil), grammarTryAssignmentSources...), grammarTryAssignmentShapes...) {
		if got := grammarAdmissionForm(source); got != "admission:try-assignment-target" {
			t.Errorf("try assignment target lost its key: got %q: %s", got, source)
		}
	}
	for _, source := range []string{
		"effect function f(p: number) { try (p = 1) }",
		"effect function f(p: number) { const b = try p == 1 }",
		"effect function f(p: number) { try p }",
		"function f() { try { } catch { } }",
		"effect function f(xs: number[]) { for try (const x of xs) {} }",
		"effect function f(o: { try: number }) { o.try = 1 }",
		"effect function f(p: number) { try p => 1 }",
	} {
		if grammarTryAssignmentTarget(grammarLexSource(source)) {
			t.Errorf("valid or independent syntax entered the try-assignment family: %s", source)
		}
	}
}

func TestGrammarAdmissionTryAssignmentRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarTryAssignmentSources {
		t.Run(source, func(t *testing.T) {
			if grammarArrowSafeSyntaxRejected(t, w, source) {
				t.Fatalf("try assignment target is now rejected as syntax: %s", source)
			}
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("recorded try-assignment admission gap changed: %s", source)
			}
			checkGrammarAdmission(t, w, "admission:try-assignment-target", source)
		})
	}
	paren := "import { Effect } from \"effect\"\nexport effect function f() {\n  let p = 0\n  try (p = 1)\n  return p\n}\n"
	if grammarAdmissionVerdict(t, w, paren) {
		t.Errorf("parenthesized assignment operand reads as an admission gap: %s", paren)
	}
	twin := "export async function f() {\n  let p = 0\n  await p = 1\n  return p\n}\n"
	if !grammarArrowSafeSyntaxRejected(t, w, twin) {
		t.Errorf("the ECMAScript twin is no longer a syntax error: %s", twin)
	}
}

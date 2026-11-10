package vibelangfuzz

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/binder"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// The pinned MatchList ends in its one optional rest element, and a
// MatchProperty's colon is followed by a MatchPattern. Neither admits a
// missing pattern or an element after the rest.
const grammarUnhomedPatternListQuote = "MatchList[Yield, Await] :\n        Elision? MatchRestElement[?Yield, ?Await]?\n        MatchElementList[?Yield, ?Await]\n        MatchElementList[?Yield, ?Await] `,` Elision? MatchRestElement[?Yield, ?Await]?"

const grammarUnhomedPatternPropertyQuote = "PropertyName[?Yield, ?Await] `?`? `:` MatchPattern[?Yield, ?Await]"

func TestGrammarAdmissionUnhomedPatternQuoted(t *testing.T) {
	text := SpecText("../vips/tc39-pattern-matching/spec.emu")
	for _, quote := range []string{grammarUnhomedPatternListQuote, grammarUnhomedPatternPropertyQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("pinned pattern production changed; review the admission key: %q", quote)
		}
	}
}

// grammarPatternMarker is one $patternError call the parser wrote: the
// placement marker of an is pattern whose bindings have no lexical home
// (4703), or a pattern grammar error deferred to the checker.
type grammarPatternMarker struct {
	code     int
	pos, end int
}

func grammarPatternMarkers(file *ast.SourceFile) []grammarPatternMarker {
	var found []grammarPatternMarker
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n == nil {
			return false
		}
		if ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "$patternError" && n.Expression().Flags&ast.NodeFlagsReparsed != 0 {
			if args := n.Arguments(); len(args) > 0 && args[0].Kind == ast.KindNumericLiteral {
				if code, err := strconv.Atoi(args[0].Text()); err == nil {
					found = append(found, grammarPatternMarker{code, n.Pos(), n.End()})
				}
			}
		}
		return n.ForEachChild(visit)
	}
	visit(file.AsNode())
	return found
}

// grammarUnhomedPatternGrammar reports an is pattern that stays behind its
// placement marker and whose own text, read in an if condition where the
// compiler does compile the pattern, carries a parser or binder syntax
// error. The compiler then reports the placement error alone (EK4703, or
// EK0705 in a parameter default or enum initializer), which covers the
// pattern's own rejection. A pattern the compiler would accept in the if
// condition is no member, whatever its home.
func grammarUnhomedPatternGrammar(source string, file *ast.SourceFile) bool {
	for _, marker := range grammarPatternMarkers(file) {
		if marker.code != 4703 || marker.pos < 0 || marker.end > len(source) || marker.end <= marker.pos {
			continue
		}
		homed, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{
			FileName: "/fuzz/main.vibe", PathKey: "/fuzz/main.vibe",
		}, "if ("+source[marker.pos:marker.end]+") {}")
		for _, inner := range grammarPatternMarkers(homed) {
			if inner.code != 4703 && grammarAdmissionSyntaxCode(int32(inner.code)) {
				return true
			}
		}
		// Reserved references and bindings are rejected by the binder. Reading
		// the homed tree also preserves IdentifierName positions, so a property
		// named static is distinct from a reference to static.
		binder.BindSourceFile(homed)
		for _, diagnostic := range homed.BindDiagnostics() {
			if grammarAdmissionSyntaxDiagnostic(diagnostic) {
				return true
			}
		}
	}
	return false
}

// The campaign witness: a mutation put `=>` between the two rest markers of
// the landed duplicated-rest witness.
const grammarUnhomedPatternWitness = "for (\nvar i = 0 ; xs is [ let first , ... => ... ] ; i ++ ) { }"

var grammarUnhomedPatternGaps = []string{
	grammarUnhomedPatternWitness,
	"for (var i = 0; xs is [let first, ..., 1]; i++) {}",
	"function g(a = xs is [let first, ..., 1]) {}",
	"for (var i = 0; xs is { a: let first, b: }; i++) {}",
	"for (var i = 0; xs is [let first, ?]; i++) {}",
	"for (var i = 0; xs is [let first, > f()]; i++) {}",
	"for (using r = f(); xs is [let first, ..., 1]; ) {}",
	"for (var i = 0; ; xs is [let first, ..., 1]) {}",
	"switch (0) { case xs is [let first, ..., 1]: }",
	"enum E { A = xs is [let first, ..., 1] }",
	"class C { [xs is [let first, ..., 1]]() {} }",
	"class C extends (xs is [let first, ..., 1]) {}",
	"export default xs is [let first, ..., 1];",
	"const b = match (xs is [let first, ..., 1]) { default: 0; };",
	"effect function f(xs) { return xs is [let first, ..., 1] catch () => 1 }",
	// A strict-mode reserved word as a binding name: the binder's TS1214,
	// which the placement marker hides.
	"for ( var i\n= 0 ; xs is [ let let , ... ] ; i ++ ) { }",
	"for (var i = 0; xs is [let static]; i++) {}",
	"for (var i = 0; xs is { a: const yield }; i++) {}",
	"function g(a = xs is [let let]) {}",
}

func TestGrammarAdmissionUnhomedPatternKeys(t *testing.T) {
	for _, source := range grammarUnhomedPatternGaps {
		if got := grammarAdmissionForm(source); got != "admission:unhomed-pattern-grammar" {
			t.Errorf("key=%q, want admission:unhomed-pattern-grammar: %q", got, source)
		}
	}
	// The duplicated rest marker keeps its landed key.
	if got := grammarAdmissionForm(grammarPatternRestEllipsisWitness); got != "admission:pattern-rest-ellipsis" {
		t.Errorf("key=%q, want admission:pattern-rest-ellipsis: %q", got, grammarPatternRestEllipsisWitness)
	}
	for _, source := range []string{
		// A well-formed pattern behind the same placement marker.
		"for (var i = 0; xs is [let first, ...]; i++) {}",
		"for (var i = 0; xs is [let first, ...let rest]; i++) {}",
		"for (var i = 0; xs is [let first, , ]; i++) {}",
		"function g(a = xs is [let first]) {}",
		"switch (0) { case xs is [let first]: }",
		// The same malformed pattern where a home compiles it.
		"for (let i = 0; xs is [let first, ..., 1]; i++) {}",
		"if (xs is [let first, ..., 1]) {}",
		"while (xs is [let first, ..., 1]) {}",
		"const b = xs is [let first, ..., 1];",
		"class C { x = xs is [let first, ..., 1]; }",
		"const g = () => xs is [let first, ..., 1];",
		"const b = match (y) { when [let first, ..., 1]: 1; default: 0; };",
		// No binding, so no marker.
		"for (var i = 0; xs is [1, ..., 1]; i++) {}",
		// A reserved word as a property name or a literal is not a binding.
		"for (var i = 0; xs is { let: 1 }; i++) {}",
		"for (var i = 0; xs is [let first, \"let\"]; i++) {}",
		// Text that only spells the form.
		"const s = 'for (var i = 0; xs is [let first, ..., 1]; i++) {}';",
		"$patternError(4703); if ($patternError(707)) {}",
	} {
		if got := grammarAdmissionForm(source); got == "admission:unhomed-pattern-grammar" {
			t.Errorf("control keyed as a deferred pattern error behind a placement marker: %q", source)
		}
	}
}

func TestGrammarAdmissionUnhomedPatternRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarUnhomedPatternGaps {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range []string{
		"for (var i = 0; xs is [let first, ...]; i++) {}",
		"for (var i = 0; xs is [let first, ...let rest]; i++) {}",
		"for (let i = 0; xs is [let first, ..., 1]; i++) {}",
		"if (xs is [let first, ..., 1]) {}",
		"while (xs is [let first, ..., 1]) {}",
		"const b = xs is [let first, ..., 1];",
		"const b = xs is [let first, ?];",
		"const b = xs is { a: let first, b: };",
		"function g(a = xs is [let first]) {}",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}

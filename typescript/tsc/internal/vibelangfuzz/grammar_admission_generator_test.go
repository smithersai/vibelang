package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const grammarGeneratorInterruptionQuote = "These are statements inside an `effect` function or block, like `provide` (VIP-12)."

func TestGrammarAdmissionGeneratorInterruptionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0022-interruption-blocks.md"), grammarGeneratorInterruptionQuote) {
		t.Fatal("VIP-22 interruption placement changed; review the plain-generator pending family")
	}
}

// Only the unannotated, synchronous declaration/expression family is pending.
// The compiler still treats these source callables as implicit producers.
// A nested source callable resets ownership; parser-generated arrows for
// transparent do/match expressions preserve the enclosing source callable.
// These flags classify an already observed mismatch, never decide derivability.
func grammarAdmissionPlainGeneratorAt(file *ast.SourceFile, at int) bool {
	var owner *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n == nil || at < n.Pos() || at >= n.End() {
			return false
		}
		if ast.IsFunctionLike(n) && n.Body() != nil && n.Body().Pos() <= at && at < n.Body().End() {
			if n.Kind != ast.KindArrowFunction || n.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed == 0 {
				owner = n
			}
		}
		n.ForEachChild(visit)
		return true
	}
	visit(file.AsNode())
	return owner != nil &&
		(owner.Kind == ast.KindFunctionDeclaration || owner.Kind == ast.KindFunctionExpression) &&
		owner.Type() == nil &&
		owner.Flags&ast.NodeFlagsVibeLangEffect == 0 &&
		ast.GetFunctionFlags(owner)&(ast.FunctionFlagsGenerator|ast.FunctionFlagsAsync) == ast.FunctionFlagsGenerator
}

func TestGrammarAdmissionGeneratorInterruptionKeys(t *testing.T) {
	generator := "admission:interruption-in-generator"
	plain := "admission:interruption-outside-effect"
	for source, want := range map[string]string{
		"function* f() { uninterruptible { return 1; } }":                     generator,
		"function* f() { uninterruptible {} }":                                generator,
		"function* f() { interruptible {} }":                                  generator,
		"function* f() { uninterruptible { restore {} } }":                    generator,
		"const g = function* () { uninterruptible {} };":                      generator,
		"effect function outer() { function* g() { uninterruptible {} } }":    generator,
		"function* f() { const n = do { uninterruptible {}; 1 }; }":           generator,
		"function f() { uninterruptible {} }":                                 plain,
		"async function* f() { uninterruptible {} }":                          plain,
		"function* f(): Generator<number> { uninterruptible {} }":             plain,
		"class C { *f() { uninterruptible {} } }":                             plain,
		"function* f() { function g() { uninterruptible {} } }":               plain,
		"function* f() { const g = () => { uninterruptible {} }; }":           plain,
		"effect function* f() { uninterruptible {} }":                         "",
		"function* f() { const p = effect { uninterruptible {} }; }":          "",
		"const uninterruptible = 1; function* f() { yield uninterruptible; }": "",
	} {
		t.Run(source, func(t *testing.T) {
			if got := grammarAdmissionForm(source); got != want {
				t.Fatalf("key %q; want %q", got, want)
			}
		})
	}
	// The saved campaign bytes depend on the seed list. The new corpus instead
	// names the minimized program and stays stable when another seed is added.
	for _, seed := range grammarAdmissionSeeds {
		if seed.key == "interruption-in-generator" {
			key, source := grammarAdmissionInput([]byte("key:" + seed.key + "\n" + seed.source))
			if key != generator || source != seed.source {
				t.Fatalf("keyed generator witness changed: %q, %q", key, source)
			}
			return
		}
	}
	t.Fatal("plain-generator interruption seed is missing")
}

// The original witness reported only a join operand type error. Keep it
// as a rejection control after plain native generators stop admitting join.
func TestGrammarAdmissionFiberInGenerator(t *testing.T) {
	w := NewWorkspace(t)
	witness := "function * g (\n) { join effect % 1 ; }"
	result, err := w.Compile(context.Background(), Single(witness))
	if err != nil {
		t.Fatal(err)
	}
	syntax := false
	for _, diagnostic := range result.Diagnostics {
		syntax = syntax || grammarAdmissionSyntaxDiagnostic(diagnostic)
	}
	if !syntax || grammarAdmissionVerdict(t, w, witness) {
		t.Fatalf("plain-generator fiber witness must retain syntax rejection; diagnostics=%v", result.Diagnostics)
	}
	t.Logf("former plain-generator gap rejects with %v", result.Diagnostics)
	for source, want := range map[string]string{
		witness:                                  "admission:fiber-in-generator",
		"function * g ( ) { join effect % 1 ; }": "admission:fiber-in-generator",
		"function g ( ) { join effect % 1 ; }":   "admission:join-outside-effect",
		"effect function * g ( p ) { join p ; }": "",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("%q keyed %q, want %q", source, got, want)
		}
	}
}

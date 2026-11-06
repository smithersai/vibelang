package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

const grammarOptionalEffectQuote = "`effect` goes exactly where TypeScript allows `async`, and nowhere else"
const grammarOptionalProducerQuote = `"*" ClassElementName TypeParameters? Params`

func TestGrammarAdmissionOptionalClassMemberQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), grammarOptionalEffectQuote) ||
		!strings.Contains(SpecText(grammarAppendix), grammarOptionalProducerQuote) {
		t.Fatal("native Effect member authority or Appendix A optional-member gap changed; review pending coverage")
	}
}

// This only groups a proven Appendix A mismatch. VIP-1 admits native async
// class positions; the current EffectClassMethod and ProducerMethod spellings
// omit the optional marker. Object members and native methods stay separate.
func grammarOptionalEffectClassMember(file *ast.SourceFile, source string) bool {
	marks := map[int]bool{}
	var visit func(*ast.Node, *ast.Node)
	visit = func(n, parent *ast.Node) {
		if n == nil {
			return
		}
		if n.Kind == ast.KindMethodDeclaration && parent != nil &&
			(parent.Kind == ast.KindClassDeclaration || parent.Kind == ast.KindClassExpression) &&
			n.Flags&ast.NodeFlagsVibeLangEffect != 0 {
			if token := n.PostfixToken(); token != nil && token.Kind == ast.KindQuestionToken {
				at := token.End() - 1
				if at >= 0 && at < len(source) && source[at] == '?' {
					marks[at] = true
				}
			}
		}
		n.ForEachChild(func(child *ast.Node) bool { visit(child, n); return false })
	}
	visit(file.AsNode(), nil)
	if len(marks) == 0 {
		return false
	}
	var normalized strings.Builder
	for i := 0; i < len(source); i++ {
		if !marks[i] {
			normalized.WriteByte(source[i])
		}
	}
	// An unrelated body or header gap must keep its own key. Removing only
	// these optional marks must leave a complete Appendix A derivation.
	lab, err := admissionLab()
	return err == nil && lab.read(lab.g, grammarLexSource(normalized.String()), grammarParseMode{prose: true, names: true}).count != 0
}

var grammarOptionalEffectClasses = []string{
	"class C { effect *g?() { yield 1; } }",
	"class C { effect g?() { return 1; } }",
	"class C { static effect *g?() { yield 1; } }",
	"class C { effect *[\"g\"]?() { yield 1; } }",
	"class C { effect *g?<T>(x: T) { yield x; } }",
	"const C = class { effect *g?() { yield 1; } };",
	"class C { effect g?<T>(x: T) { return x; } }",
}

func TestGrammarAdmissionOptionalClassMemberKeys(t *testing.T) {
	for _, source := range grammarOptionalEffectClasses {
		if got := grammarAdmissionForm(source); got != "admission:effect-optional-class-member" {
			t.Errorf("optional class member lost its pending key: got %q: %s", got, source)
		}
	}
	for _, source := range []string{
		"class C { *g?() { yield 1; } }",
		"class C { async *g?() { yield 1; } }",
		"class C { async g?() { return 1; } }",
		"class C { effect?() { return 1; } }",
		"class C { effect *g() { yield 1; } }",
		"class C { effect g() { return 1; } }",
		"const o = { effect *g?() { yield 1; } };",
		"class C { g?: unknown = effect () => 1; }",
		"class C { effect *g?() { const b = x is 1 + 1; yield 1; } }",
	} {
		if got := grammarAdmissionForm(source); got == "admission:effect-optional-class-member" {
			t.Errorf("a separate member form entered the optional Effect class family: %s", source)
		}
	}
}

func TestGrammarAdmissionOptionalClassMemberKeepsBodyGap(t *testing.T) {
	source := "class C { effect *g?() { const b = x is 1 + 1; yield 1; } }"
	if got := grammarAdmissionForm(source); got != "admission:is-operand-precedence" {
		t.Fatalf("optional-header grouping hid a separate body gap: %q", got)
	}
}

func TestGrammarAdmissionOptionalClassMember(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarOptionalEffectClasses {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("the recorded optional-member derivation gap changed: %s", source)
			}
			checkGrammarAdmission(t, w, "admission:effect-optional-class-member", source)
		})
	}
}

func TestGrammarAdmissionNativeOptionalClassMember(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"class C { *g?() { yield 1; } }",
		"class C { async *g?() { yield 1; } }",
		"class C { async g?() { return 1; } }",
		"class C { static async *g?() { yield 1; } }",
		"class C { async *[\"g\"]?() { yield 1; } }",
		"class C { async *g?<T>(x:T) { yield x; } }",
		"class C { g?() { return 1; } }",
	} {
		if ds := parseAs(parseKind{"optional.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
			t.Fatalf("native parser rejected a class control: %v", ds)
		}
		for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
			if lab.read(g, grammarLexSource(source), grammarParseMode{}).count == 0 {
				t.Errorf("%s native optional class member has no derivation: %s", name, source)
			}
		}
	}
	for _, source := range []string{
		"const o = { async *g?() { yield 1; } };",
		"const o = { *g?() { yield 1; } };",
		"const o = { async g?() { return 1; } };",
	} {
		for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
			if lab.read(g, grammarLexSource(source), grammarParseMode{}).count != 0 {
				t.Errorf("%s class-only optional branch leaked into an object: %s", name, source)
			}
		}
	}
}

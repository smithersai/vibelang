package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const modifierIsQuote = "At a statement start or after `export`, `effect` or `async` followed by a name other than `as`, `satisfies` or `is`, then `(` or `<`, parses so this rule can report it."
const modifierIdentifierQuote = "Anywhere else, `effect` is an ordinary identifier, so `Layer.effect(…)` and `const effect = …` keep working."
const modifierMethodQuote = "`effect` goes exactly where TypeScript allows `async`, and nowhere else (VIP-1), apart from the `effect { … }` block (VIP-2)."
const modifierIsExpressionQuote = "`subject is P` evaluates the subject once and returns the pattern's Boolean result, using the same cache and finishing rules as `match`."

func TestModifierIsExpressionsQuoted(t *testing.T) { requireModifierIsQuotes(t) }
func requireModifierIsQuotes(t testing.TB) {
	t.Helper()
	for chapter, quotes := range map[string][]string{
		"001-functions.md": {modifierIsQuote, modifierIdentifierQuote, modifierMethodQuote},
		"004-match.md":     {modifierIsExpressionQuote},
	} {
		source, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			t.Fatal(err)
		}
		for _, quote := range quotes {
			if !strings.Contains(string(source), quote) {
				t.Fatalf("%s no longer contains %q", chapter, quote)
			}
		}
	}
}

// VIP-1 and VIP-7 distinguish contextual modifier words in expression statements
// from declarations and methods named is. The AST oracle rejects an invented
// function declaration even when a following block makes that parse error-free.
func FuzzModifierIsExpressions(f *testing.F) {
	startShortBudget(f)
	requireModifierIsQuotes(f)
	for _, key := range []string{"top", "plain-body", "effect-body", "async-body", "generator-body", "arrow-body", "class-body", "object-body", "if-body", "switch-body", "do-body", "following-block", "label-body", "explicit-function-is", "class-is-method", "object-is-method"} {
		for _, mode := range []uint8{0, 3, 12} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		word, pattern, gap := "effect", "Number", " "
		if mode&1 != 0 {
			word = "async"
		}
		if mode&2 != 0 {
			pattern = "String"
		}
		if mode&4 != 0 {
			gap = " /* modifier boundary */ "
		}
		expression := word + gap + "is (" + pattern + ")"
		source := expression
		wantFunctions, wantMethods := 0, 0
		switch key {
		case "plain-body":
			source = "function f() { " + expression + " }"
		case "effect-body":
			source = "effect function f() { " + expression + " }"
		case "async-body":
			source = "async function f() { " + expression + " }"
		case "generator-body":
			source = "function* f() { " + expression + " }"
		case "arrow-body":
			source = "const f = () => { " + expression + " }"
		case "class-body":
			source = "class C { read() { " + expression + " } }"
		case "object-body":
			source = "const c = { read() { " + expression + " } }"
		case "if-body":
			source = "if (true) " + expression
		case "switch-body":
			source = "switch (0) { case 0: " + expression + "; }"
		case "do-body":
			source = "const value = do { " + expression + "; true }"
		case "following-block":
			source = expression + "\n{}"
		case "label-body":
			source = "label: { " + expression + " }"
		case "explicit-function-is":
			source = word + gap + "function is(input: unknown) { return input }"
			wantFunctions = 1
		case "class-is-method":
			source = "class C { " + word + gap + "is(input: unknown) { return input } }"
			wantMethods = 1
		case "object-is-method":
			source = "const c = { " + word + gap + "is(input: unknown) { return input } }"
			wantMethods = 1
		default:
			key = "top"
		}
		if mode&8 != 0 {
			source = "const café = \"😀\";\n" + source
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/modifier-is.vibe", PathKey: "/modifier-is.vibe"}, source, core.ScriptKindTS)
		gapKey := "modifier-is:" + key + ":" + word
		if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
			Gap(t, "FuzzModifierIsExpressions", gapKey, "%s; parse diagnostics %v\n%s", modifierIsQuote, diagnostics, source)
			return
		}
		functions, methods := 0, 0
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsFunctionDeclaration(n) && n.Name() != nil && n.Name().Text() == "is" {
				functions++
			}
			if ast.IsMethodDeclaration(n) && n.Name() != nil && n.Name().Text() == "is" {
				methods++
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		if functions != wantFunctions || methods != wantMethods {
			Gap(t, "FuzzModifierIsExpressions", gapKey, "%s; %s; named-is declarations/methods %d/%d, want%d/%d\n%s", modifierIsQuote, modifierIsExpressionQuote, functions, methods, wantFunctions, wantMethods, source)
		}
	})
}

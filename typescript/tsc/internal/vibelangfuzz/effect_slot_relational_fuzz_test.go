package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const effectSlotRelationalQuote = "A leading `<` does not start a type at the type-operator level: `x as A!! < 3` omits `R` and continues with a comparison, subject to ordinary operand checking."

func requireEffectSlotRelationalQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectSlotRelationalQuote) {
		t.Fatalf("missing spec quote: %s", effectSlotRelationalQuote)
	}
}
func TestEffectSlotRelationalQuoted(t *testing.T) { requireEffectSlotRelationalQuote(t) }

// Compare expression structure and channels with the explicit Effect TS
// counterpart. The oracle follows native expressions, not slot lookahead.
func FuzzEffectSlotRelational(f *testing.F) {
	startShortBudget(f)
	requireEffectSlotRelationalQuote(f)
	for _, key := range []string{"number", "identifier", "call", "unary", "negative-requirement", "tuple-requirement", "generic-requirement", "less-equal", "greater", "left-shift"} {
		for _, mode := range []uint8{0, 1, 2, 4, 8, 15, 16, 23} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		shorthand, explicit := "number!!", "Effect.Effect<number, never, never>"
		op, right := "<", "3"
		switch key {
		case "identifier":
			right = "limit"
		case "call":
			right = "limit()"
		case "unary":
			right = "+3"
		case "negative-requirement":
			shorthand, explicit = "number!!-1", "Effect.Effect<number, never, -1>"
		case "tuple-requirement":
			shorthand, explicit = "number!![0]", "Effect.Effect<number, never, [0]>"
		case "generic-requirement":
			shorthand, explicit = "number!!(<T>() => T)", "Effect.Effect<number, never, (<T>() => T)>"
		case "less-equal":
			op = "<="
		case "greater":
			op = ">"
		case "left-shift":
			op = "<<"
		default:
			key = "number"
		}
		gap, prefix := " ", ""
		if mode&2 != 0 {
			prefix = "const café = '😀';\n"
		}
		if mode&4 != 0 {
			gap = " /* comparison */ "
		}
		if mode&8 != 0 {
			gap += "\n"
		}
		assertion := "as"
		if mode&16 != 0 {
			assertion = "satisfies"
		}
		expr, native := "value "+assertion+" "+shorthand, "value "+assertion+" "+explicit
		if mode&1 != 0 {
			expr, native = "("+expr+")", "("+native+")"
		}
		source := prefix + "export const result = " + expr + gap + op + " " + right + "\n"
		counterpart := prefix + "export const result = " + native + gap + op + " " + right + "\n"
		a := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		b := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, counterpart, core.ScriptKindTS)
		if len(b.Diagnostics()) != 0 {
			t.Fatalf("bad native oracle: %v\n%s", b.Diagnostics(), counterpart)
		}
		if len(a.Diagnostics()) != 0 {
			Gap(t, "FuzzEffectSlotRelational", "effect-slot-relational:"+key, "%s\n%s\n%v", effectSlotRelationalQuote, source, a.Diagnostics())
			return
		}
		x, y := relationalInitializer(a), relationalInitializer(b)
		if x == nil || y == nil || x.Kind != ast.KindBinaryExpression || y.Kind != ast.KindBinaryExpression {
			Gap(t, "FuzzEffectSlotRelational", "effect-slot-relational:"+key, "lost native binary comparison: %s", source)
			return
		}
		ax, by := x.AsBinaryExpression(), y.AsBinaryExpression()
		if ax.OperatorToken.Kind != by.OperatorToken.Kind || ax.Right.Kind != by.Right.Kind {
			Gap(t, "FuzzEffectSlotRelational", "effect-slot-relational:"+key, "operator/right changed: %s", source)
			return
		}
		left, other := relationalUnwrap(ax.Left), relationalUnwrap(by.Left)
		if left == nil || other == nil || left.Kind != other.Kind || (left.Kind != ast.KindAsExpression && left.Kind != ast.KindSatisfiesExpression) {
			t.Fatal("counterpart lost assertion")
		}
		args, want := left.Type().TypeArguments(), other.Type().TypeArguments()
		if len(args) != 3 || len(want) != 3 {
			t.Fatalf("three channels required: %s", source)
		}
		for i := range args {
			if relationalTypeUnwrap(args[i]).Kind != relationalTypeUnwrap(want[i]).Kind {
				Gap(t, "FuzzEffectSlotRelational", "effect-slot-relational:"+key, "channel %d changed: %s", i, source)
				return
			}
		}
	})
}
func relationalInitializer(file *ast.SourceFile) *ast.Node {
	var result *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Kind == ast.KindVariableDeclaration && n.Name() != nil && n.Name().Text() == "result" {
			result = n.AsVariableDeclaration().Initializer
			return true
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return result
}
func relationalUnwrap(n *ast.Node) *ast.Node {
	for n != nil && n.Kind == ast.KindParenthesizedExpression {
		n = n.AsParenthesizedExpression().Expression
	}
	return n
}
func relationalTypeUnwrap(n *ast.Node) *ast.Node {
	for n.Kind == ast.KindParenthesizedType {
		n = n.AsParenthesizedTypeNode().Type
	}
	return n
}

// Keep the recovered legacy function channel available for EK0301 migration.
// The old compiler accepts these heads; strict bang admission may add EK0301,
// but native type names must not turn into value-level await/yield syntax.
func TestEffectSlotRelationalLegacyTypeContext(t *testing.T) {
	for _, tc := range []struct{ prefix, name string }{
		{"async function host() { ", "await"},
		{"function* host() { ", "yield"},
	} {
		source := tc.prefix + "const result = value as number!!<" + tc.name + ">(x: " + tc.name + ") => " + tc.name + "; return result }"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		count := 0
		for _, d := range file.Diagnostics() {
			if d.Code() != 301 {
				t.Fatalf("lost type context %s: %v", tc.name, d)
			}
			count++
		}
		if count > 1 {
			t.Fatal("duplicate EK0301")
		}
		result := relationalUnwrap(relationalInitializer(file))
		if result == nil || result.Kind != ast.KindAsExpression {
			t.Fatalf("lost assertion: %s", source)
		}
		args := result.Type().TypeArguments()
		if len(args) != 3 || args[2].Kind != ast.KindFunctionType {
			t.Fatalf("lost legacy generic function R: %s", source)
		}
	}
}

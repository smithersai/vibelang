package vibelangfuzz

import (
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const requirementContinuationQuote = "In an expression, `x as A!! as B` and `x as A!! satisfies B` retain the ordinary chained assertion or check when consuming the keyword as `R` would strand `B`."
const requirementASIQuote = "A complete source parse includes TypeScript’s automatic semicolon insertion."
const requirementPriorityQuote = "When both complete source parses survive, prefer the present `R`, with no symbol lookup."

func requireEffectRequirementContinuationQuotes(t testing.TB) {
	t.Helper()
	for _, quote := range []string{requirementContinuationQuote, requirementASIQuote, requirementPriorityQuote} {
		if !strings.Contains(SpecText("900-appendices.md"), quote) {
			t.Fatal("missing specification quote: " + quote)
		}
	}
}

func TestEffectRequirementContinuationsQuoted(t *testing.T) {
	requireEffectRequirementContinuationQuotes(t)
}

var requirementContinuationKeys = []string{
	"chain-as", "chain-satisfies", "alias-as", "alias-satisfies",
	"alias-chain-as", "alias-chain-satisfies", "pure-as", "pure-satisfies",
	"required-as", "group-as", "asi-as", "asi-satisfies",
	"for-of-chain", "for-of-present", "for-of-reconsider",
	"argument-as",
	"parenthesized-as",
	"array-as",
	"object-property-as",
	"condition-as",
	"for-of-newline-as",
	"conditional-true-as",
	"arrow-argument-as",
	"argument-block-asi",
	"object-method-asi",
	"return-asi",
	"assignment-asi",
	"long-chain",
}

func requirementContinuationPair(key string, mode uint8) (string, string) {
	head := "declare let value: unknown; declare const iterable: any[]; declare const other: unknown; declare function consume(value: unknown): void; type as = unknown; type satisfies = unknown;\n"
	shorthand, explicit := "", ""
	switch key {
	case "chain-as":
		shorthand, explicit = "export const result = value as number!! as unknown;", "export const result = value as Effect.Effect<number, never, never> as unknown;"
	case "chain-satisfies":
		shorthand, explicit = "export const result = value as number!! satisfies unknown;", "export const result = value as Effect.Effect<number, never, never> satisfies unknown;"
	case "alias-as":
		shorthand, explicit = "export const result = value as number!!as;", "export const result = value as Effect.Effect<number, never, as>;"
	case "alias-satisfies":
		shorthand, explicit = "export const result = value as number!!satisfies;", "export const result = value as Effect.Effect<number, never, satisfies>;"
	case "alias-chain-as":
		shorthand, explicit = "export const result = value as number!!as as unknown;", "export const result = value as Effect.Effect<number, never, as> as unknown;"
	case "alias-chain-satisfies":
		shorthand, explicit = "export const result = value as number!!as satisfies unknown;", "export const result = value as Effect.Effect<number, never, as> satisfies unknown;"
	case "pure-as":
		shorthand, explicit = "export type Result = number!!as;", "export type Result = Effect.Effect<number, never, as>;"
	case "pure-satisfies":
		shorthand, explicit = "export type Result = number!!satisfies;", "export type Result = Effect.Effect<number, never, satisfies>;"
	case "required-as":
		shorthand, explicit = "export type Result = number!never!as;", "export type Result = Effect.Effect<number, never, as>;"
	case "group-as":
		shorthand, explicit = "export const result = value as number!!(as);", "export const result = value as Effect.Effect<number, never, (as)>;"
	case "asi-as":
		shorthand, explicit = "export const result = value as number!!as\nother;", "export const result = value as Effect.Effect<number, never, as>\nother;"
	case "asi-satisfies":
		shorthand, explicit = "export const result = value as number!!satisfies\nother;", "export const result = value as Effect.Effect<number, never, satisfies>\nother;"
	case "for-of-chain":
		shorthand, explicit = "for (const item of value as number!! as any) {}", "for (const item of value as Effect.Effect<number, never, never> as any) {}"
	case "for-of-present":
		shorthand, explicit = "for (value as number!!as of iterable) {}", "for (value as Effect.Effect<number, never, as> of iterable) {}"
	case "for-of-reconsider":
		shorthand, explicit = "for (value as number!! as satisfies of iterable) {}", "for (value as Effect.Effect<number, never, never> as satisfies of iterable) {}"
	case "argument-as":
		shorthand, explicit = "consume(value as number!! as\nunknown);", "consume(value as Effect.Effect<number, never, never> as\nunknown);"
	case "parenthesized-as":
		shorthand, explicit = "export const result = (value as number!! as\nunknown);", "export const result = (value as Effect.Effect<number, never, never> as\nunknown);"
	case "array-as":
		shorthand, explicit = "export const result = [value as number!! as\nunknown];", "export const result = [value as Effect.Effect<number, never, never> as\nunknown];"
	case "object-property-as":
		shorthand, explicit = "export const result = ({ result: value as number!! as\nunknown });", "export const result = ({ result: value as Effect.Effect<number, never, never> as\nunknown });"
	case "condition-as":
		shorthand, explicit = "if (value as number!! as\nany) {}", "if (value as Effect.Effect<number, never, never> as\nany) {}"
	case "for-of-newline-as":
		shorthand, explicit = "for (const item of value as number!! as\nany) {}", "for (const item of value as Effect.Effect<number, never, never> as\nany) {}"
	case "conditional-true-as":
		shorthand, explicit = "export const result = true ? value as number!! as\nunknown : other;", "export const result = true ? value as Effect.Effect<number, never, never> as\nunknown : other;"
	case "arrow-argument-as":
		shorthand, explicit = "consume(() => value as number!! as\nunknown);", "consume(() => value as Effect.Effect<number, never, never> as\nunknown);"
	case "argument-block-asi":
		shorthand, explicit = "consume(() => { const inner = value as number!!as\nother; return inner; });", "consume(() => { const inner = value as Effect.Effect<number, never, as>\nother; return inner; });"
	case "object-method-asi":
		shorthand, explicit = "export const result = { read() { const inner = value as number!!as\nother; return inner; } };", "export const result = { read() { const inner = value as Effect.Effect<number, never, as>\nother; return inner; } };"
	case "return-asi":
		shorthand, explicit = "export function read() { return value as number!!as\nother; }", "export function read() { return value as Effect.Effect<number, never, as>\nother; }"
	case "assignment-asi":
		shorthand, explicit = "let target: unknown; target = value as number!!as\nother;", "let target: unknown; target = value as Effect.Effect<number, never, as>\nother;"
	case "long-chain":
		shorthand = "export const result = value" + strings.Repeat(" as number!!as", 64) + ";"
		explicit = "export const result = value" + strings.Repeat(" as Effect.Effect<number, never, as>", 64) + ";"
	default:
		return "", ""
	}
	// The first operator has the same ambiguity for satisfies. For-of's
	// assignment target controls stay as assertions, which can be assigned.
	if mode&8 != 0 && key != "for-of-present" && key != "for-of-reconsider" {
		head = strings.Replace(head, "value: unknown", "value: any", 1)
		shorthand = strings.ReplaceAll(shorthand, "value as", "value satisfies")
		explicit = strings.ReplaceAll(explicit, "value as", "value satisfies")
	}
	// This oracle is syntax-only. Missing type names are ordinary checker
	// errors and must never choose a different R parse.
	if mode&16 != 0 {
		head = strings.ReplaceAll(head, "type as = unknown; type satisfies = unknown;", "")
	}
	if mode&1 != 0 {
		shorthand = strings.ReplaceAll(shorthand, "value as", "(value) as")
		explicit = strings.ReplaceAll(explicit, "value as", "(value) as")
		shorthand = strings.ReplaceAll(shorthand, "value satisfies", "(value) satisfies")
		explicit = strings.ReplaceAll(explicit, "value satisfies", "(value) satisfies")
	}
	if mode&2 != 0 {
		head = "const café = '😀';\n" + head
	}
	if mode&4 != 0 {
		shorthand = strings.ReplaceAll(shorthand, "!!", "!! /* boundary */ ")
	}
	return head + shorthand, head + explicit
}

// Compare the complete expression/statement tree, including ASI and the R
// channel, against the explicit ordinary TypeScript counterpart. No parser
// recovery tree or symbol lookup determines the expected choice.
func checkRequirementContinuation(t *testing.T, key string, mode uint8) {
	t.Helper()
	source, native := requirementContinuationPair(key, mode)
	if source == "" {
		return
	}
	reference := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, native, core.ScriptKindTS)
	if ds := reference.Diagnostics(); len(ds) != 0 {
		t.Fatalf("invalid native reference %s: %v\n%s", key, ds, native)
	}
	actual := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
	if ds := actual.Diagnostics(); len(ds) != 0 {
		t.Fatalf("%s mode%d: %v\n%s", key, mode, ds, source)
	}
	var tree func(*ast.Node) string
	tree = func(n *ast.Node) string {
		var out strings.Builder
		out.WriteString(strconv.Itoa(int(n.Kind)))
		if ast.IsIdentifier(n) || ast.IsStringLiteral(n) || ast.IsNumericLiteral(n) {
			out.WriteString(":" + strconv.Quote(n.Text()))
		}
		out.WriteByte('[')
		n.ForEachChild(func(child *ast.Node) bool { out.WriteString(tree(child)); out.WriteByte(','); return false })
		out.WriteByte(']')
		return out.String()
	}
	if got, want := tree(actual.AsNode()), tree(reference.AsNode()); got != want {
		t.Fatalf("%s mode%d: changed complete parse\n%s\nactual %s\nnative %s", key, mode, source, got, want)
	}
}

func TestEffectRequirementContinuations(t *testing.T) {
	for _, key := range requirementContinuationKeys {
		t.Run(key, func(t *testing.T) { checkRequirementContinuation(t, key, 0) })
	}
}

// Appendix A, optional requirement priority: docs/design/src/900-appendices.md#effectoperand
func FuzzEffectRequirementContinuations(f *testing.F) {
	startShortBudget(f)
	requireEffectRequirementContinuationQuotes(f)
	for _, key := range requirementContinuationKeys {
		for _, mode := range []uint8{0, 1, 2, 4, 7, 8, 15, 16, 31} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		i := slices.Index(requirementContinuationKeys, key)
		if i < 0 {
			if key == "" {
				return
			}
			key = requirementContinuationKeys[int(key[0])%len(requirementContinuationKeys)]
		}
		checkRequirementContinuation(t, key, mode&31)
	})
}

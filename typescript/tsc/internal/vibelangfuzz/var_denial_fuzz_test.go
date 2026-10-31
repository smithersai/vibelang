package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

const varDenialQuote = "every `var` declaration, `for (var …)` included"
const varPropertyQuote = "Property names on ordinary objects"

func requireVarDenialQuotes(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{varDenialQuote, varPropertyQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("missing var rule: %q", quote)
		}
	}
}
func TestVarDenialQuoted(t *testing.T) { requireVarDenialQuotes(t) }
func FuzzVarDenial(f *testing.F) {
	startShortBudget(f)
	requireVarDenialQuotes(f)
	for _, key := range []string{"plain", "effect", "async", "arrow", "method", "module", "for", "for-in", "for-of", "destructured", "ambient", "do", "do-call-argument", "do-nested", "do-for-head", "property-control", "literal-control", "let-control"} {
		for _, mode := range []uint8{0, 1, 2} {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		gap := []string{" ", " /* declaration */ ", "\t"}[mode%3]
		declaration := "var" + gap + "value = 1"
		source := "export function load(): number { " + declaration + "; return value }"
		want := 1
		switch key {
		case "effect":
			source = "export effect function load() { " + declaration + "; return value }"
		case "async":
			source = "export async function load() { " + declaration + "; return value }"
		case "arrow":
			source = "export const load = () => { " + declaration + "; return value }"
		case "method":
			source = "export class Loader { load(): number { " + declaration + "; return value } }"
		case "module":
			source = "export " + declaration
		case "for":
			source = "export function load(): number { for (var" + gap + "value = 0; value < 2; value++) {}; return 1 }"
		case "for-in":
			source = "export function load(): number { for (var" + gap + "value in { item: 1 }) {}; return 1 }"
		case "for-of":
			source = "export function load(): number { for (var" + gap + "value of [1]) {}; return 1 }"
		case "destructured":
			source = "export function load(): number { var" + gap + "{ value } = { value: 1 }; return value }"
		case "ambient":
			source = "declare var" + gap + "provided: number; export { provided }"
		case "do":
			source = "export function load(): number { return do { " + declaration + "; value } }"
		case "do-call-argument":
			source = "function identity(n: number): number { return n }; export function load(): number { identity(do { " + declaration + "; value }); return value }"
		case "do-nested":
			source = "export function load(): number { return do { { " + declaration + " }; value } }"
		case "do-for-head":
			source = "export function load(): number { return do { for (var" + gap + "value = 0; value < 2; value++) {}; value } }"
		case "property-control":
			source, want = "export const row = { var: 1 }; export const value = row.var", 0
		case "literal-control":
			source, want = "export const value = 'var value = 1' // var is text", 0
		case "let-control":
			source, want = "export function load(): number { let value = 1; const other = 2; return value + other }", 0
		default:
			key = "plain"
		}
		if mode == 2 {
			source = "// café 😀 var comment\n" + source
		}
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 107 {
				count++
			}
		}
		if count != want {
			Gap(t, "FuzzVarDenial", "var:"+key, "%s; got %d EK0107, want %d\n%s\n%v", varDenialQuote, count, want, source, result.Diagnostics)
		}
	})
}

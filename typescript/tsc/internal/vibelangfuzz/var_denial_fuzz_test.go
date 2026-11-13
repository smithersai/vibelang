package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

const varDenialQuote = "every `var` declaration, `for (var …)` included"
const varPropertyQuote = "Property names on ordinary objects"
const varGlobalAugmentationQuote = "An ambient `var` directly in `declare global { }` is exempt"

func requireVarDenialQuotes(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{varDenialQuote, varPropertyQuote, varGlobalAugmentationQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("missing var rule: %q", quote)
		}
	}
}
func TestVarDenialQuoted(t *testing.T) { requireVarDenialQuotes(t) }
func FuzzVarDenial(f *testing.F) {
	startShortBudget(f)
	requireVarDenialQuotes(f)
	for _, key := range []string{"conformance-witness", "plain", "effect", "async", "arrow", "method", "module", "for", "for-in", "for-of", "destructured", "ambient", "global-augmentation", "global-augmentation-declarators", "global-augmentation-beside-runtime", "global-augmentation-namespace", "function-named-global", "namespace-ambient", "global-augmentation-let-control", "do", "do-call-argument", "do-nested", "do-for-head", "generator-do-loop-head", "generator-for-of-head", "property-control", "literal-control", "let-control", "for-in-assignment-control", "for-of-assignment-control", "for-of-array-assignment-control", "for-of-object-assignment-control"} {
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
		quote := varDenialQuote
		if strings.HasPrefix(key, "global-augmentation") {
			quote = varGlobalAugmentationQuote
		}
		switch key {
		case "conformance-witness":
			source = "export function probe() { var x = 1; return x }"
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
		case "global-augmentation":
			// The smithers sandbox flow declares its limit this way.
			source, want = "export {}\ndeclare global { var"+gap+"__LIMIT__: number | undefined }\nexport const limit = globalThis.__LIMIT__ ?? 1", 0
		case "global-augmentation-declarators":
			source, want = "export {}\ndeclare global { interface Window { n: number }\n var"+gap+"__A__: number, __B__: string\n var"+gap+"__C__: boolean }", 0
		case "global-augmentation-beside-runtime":
			// The exemption is the ambient statement, not the file.
			source = "export {}\ndeclare global { var __LIMIT__: number }\nexport function load(): number { " + declaration + "; return value }"
		case "global-augmentation-namespace":
			source = "export {}\ndeclare global { namespace Limits { var" + gap + "max: number } }"
		case "function-named-global":
			// A function body is not a global augmentation even when named global.
			source = "export function global(): number { " + declaration + "; return value }"
		case "namespace-ambient":
			source = "declare namespace Limits { var" + gap + "max: number }\nexport const limit = Limits.max"
		case "global-augmentation-let-control":
			source, want = "export {}\ndeclare global { let __LIMIT__: number | undefined }", 0
		case "do":
			source = "export function load(): number { return do { " + declaration + "; value } }"
		case "do-call-argument":
			source = "function identity(n: number): number { return n }; export function load(): number { identity(do { " + declaration + "; value }); return value }"
		case "do-nested":
			source = "export function load(): number { return do { { " + declaration + " }; value } }"
		case "do-for-head":
			source = "export function load(): number { return do { for (var" + gap + "value = 0; value < 2; value++) {}; value } }"
		case "for-in-assignment-control":
			source, want = "export function load(): string { let value = 'outer'; for (value in do { ({ item: 1 }) }) {}; return value }", 0
		case "for-of-assignment-control":
			source, want = "export function load(): number { let value = 7; for (value of do { [1, 2] }) {}; return value }", 0
		case "for-of-array-assignment-control":
			source, want = "export function load(): number { let value = 7; for ([value] of do { [[1], [2]] }) {}; return value }", 0
		case "for-of-object-assignment-control":
			source, want = "export function load(): number { let value = 7; for ({ value } of do { [{ value: 1 }, { value: 2 }] }) {}; return value }", 0
		case "generator-do-loop-head", "generator-for-of-head":
			head := []string{"value", "[value]", "{ value }"}[mode%3]
			items := []string{"[1]", "[[1]]", "[{ value: 1 }]"}[mode%3]
			if key == "generator-do-loop-head" {
				items = "do { " + items + " }"
			}
			source = "export function* load() { var" + gap + "value = 0; for (var" + gap + head + " of " + items + ") { yield value; value += 1 }; return value }"
			want = 2
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
			Gap(t, "FuzzVarDenial", "var:"+key, "%s; got %d EK0107, want %d\n%s\n%v", quote, count, want, source, result.Diagnostics)
		}
	})
}

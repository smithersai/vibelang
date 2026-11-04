package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const objectKeyContextQuote = "\"Inside\" means the innermost enclosing function, as for `await` in JavaScript"

func requireObjectKeyQuotes(t testing.TB) {
	t.Helper()
	for _, q := range []struct{ file, text string }{{"001-functions.md", objectKeyContextQuote}} {
		text, err := os.ReadFile(SpecPath(q.file))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), q.text) {
			t.Fatalf("%s no longer says %q", q.file, q.text)
		}
	}
}
func TestObjectMemberKeyQuoted(t *testing.T) { requireObjectKeyQuotes(t) }

func FuzzObjectMemberKeyContext(f *testing.F) {
	startShortBudget(f)
	requireObjectKeyQuotes(f)
	shapes := []string{"method", "getter", "setter", "effect-method", "property"}
	contexts := []string{"effect", "plain", "nested-effect", "nested-plain"}
	keys := []string{"string", "symbol", "coercion"}
	for _, s := range shapes {
		for _, c := range contexts {
			for _, k := range keys {
				f.Add(s, c, k)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape, scope, key string) {
		normalize := func(value string, domain []string) string {
			for _, v := range domain {
				if value == v {
					return v
				}
			}
			var n uint64
			for _, b := range []byte(value) {
				n = n*33 + uint64(b)
			}
			return domain[n%uint64(len(domain))]
		}
		shape = normalize(shape, shapes)
		scope = normalize(scope, contexts)
		key = normalize(key, keys)
		value := map[string]string{
			"string":   "'method' as const",
			"symbol":   "Symbol('method')",
			"coercion": "({[Symbol.toPrimitive](){events.push('coerce');return 'method'}} as unknown as string)",
		}[key]
		expr := "try Effect.sync(() => {events.push('resolve');return " + value + "})"
		want := 0
		if scope == "plain" || scope == "nested-plain" {
			want = 1
			expr = "(" + expr + ") as unknown as PropertyKey"
		}
		makeBody := func(keyExpr string, native bool) string {
			switch shape {
			case "method":
				return fmt.Sprintf("const object = {[%s](){return 7}};", keyExpr)
			case "getter":
				return fmt.Sprintf("const object = {get [%s](){return 7}};", keyExpr)
			case "setter":
				return fmt.Sprintf("const object = {set [%s](value:number){}};", keyExpr)
			case "effect-method":
				if native {
					return fmt.Sprintf("const object = {[%s](){return Effect.succeed(7)}};", keyExpr)
				}
				return fmt.Sprintf("const object = {effect [%s](){return 7}};", keyExpr)
			default:
				return fmt.Sprintf("const object = {[%s]:()=>7};", keyExpr)
			}
		}
		prefix := "const events: string[]=[];export const traceOf=()=>events;\n"
		body := makeBody(expr, false) + "return 1"
		actual := prefix
		switch scope {
		case "effect":
			actual += "export effect function main(){" + body + "}"
		case "plain":
			actual += "export function main(){" + body + "}"
		case "nested-effect":
			actual += "export function main(){effect function inner(){" + body + "}return inner()}"
		case "nested-plain":
			actual += "export effect function main(){function inner(){" + body + "}return 1}"
		}
		files := map[string]string{"main.vibe": actual}
		if want == 0 {
			nativeBody := makeBody(strings.ReplaceAll(expr, "try Effect.sync(", "yield* Effect.sync("), true) + "return 1"
			native := "import {Effect} from 'effect';\n" + prefix
			if scope == "nested-effect" {
				native += "export function main(){function inner(){return Effect.gen(function*(){" + nativeBody + "})}return inner()}"
			} else {
				native += "export function main(){return Effect.gen(function*(){" + nativeBody + "})}"
			}
			files["native.ts"] = native
		}
		result, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		corpus := shape + "/" + scope + "/" + key
		got := 0
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 501 {
				got++
			} else if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzObjectMemberKeyContext", corpus, "Chapter001: %s: unexpected diagnostic %d: %s\n%s", objectKeyContextQuote, d.Code(), d.String(), actual)
			}
		}
		if got != want {
			Gap(t, "FuzzObjectMemberKeyContext", corpus, "Chapter001: %s: got %d EK0501, want%d\n%s", objectKeyContextQuote, got, want, actual)
		}

		ExpectPending(t, "FuzzObjectMemberKeyContext", corpus)
		ExpectPending(t, "FuzzObjectMemberKeyContext", specCorpusKey(t))
	})
}

package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func handlerHomeQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("003-failures.md")
	for _, q := range []string{
		"A call known to throw in a plain " + string(rune(96)) + "catch" + string(rune(96)) + " handler's parameters or body is " + string(rune(96)) + "EK0401" + string(rune(96)) + ".",
		"unless it sits in the " + string(rune(96)) + "try" + string(rune(96)) + " block of a " + string(rune(96)) + "try" + string(rune(96)) + " statement with a " + string(rune(96)) + "catch" + string(rune(96)) + " clause in the same function.",
	} {
		if !strings.Contains(text, q) {
			t.Fatalf("missing source-context rule %q", q)
		}
	}
}
func TestPlainHandlerHomeQuoted(t *testing.T) { handlerHomeQuoted(t) }
func FuzzPlainCatchHandlerHome(f *testing.F) {
	startShortBudget(f)
	for kind := byte(0); kind < 6; kind++ {
		for _, never := range []bool{false, true} {
			for _, choice := range []byte{0, 1, 8} {
				f.Add(kind, never, choice)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, kind byte, never bool, choice byte) {
		handlerHomeQuoted(t)
		kind %= 6
		call := `parse("x")`
		body := []string{
			`try { return ` + call + ` } catch { return "" }`,
			`return ` + call,
			`try { return ` + call + ` } finally {}`,
			`try { return "" } catch {} finally { ` + call + ` }`,
			`try { const read = () => ` + call + `; return read() } catch { return "" }`,
			`return ` + call,
		}[kind]
		handler := "() => { " + body + " }"
		want := int32(401)
		if kind == 0 {
			want = 0
		}
		if kind == 5 {
			handler = "effect " + handler
			want = 403
		}
		thrown := "Error"
		if never {
			thrown = "never"
			want = 0
		}
		if choice&1 != 0 {
			handler = "(" + handler + ")"
		}
		source := `import {Effect} from "effect"; import {parse} from "./foreign.js";
export effect function run(){ return Effect.fail(new Error("input")) catch ` + handler + " }"
		if choice&8 != 0 {
			source = "/* café 😀 */" + source
		}
		lib := "foreign.ts"
		if choice&2 != 0 {
			lib = "foreign.d.ts"
		}
		decl := "/** @throws {" + thrown + "} */" + string(rune(10)) + "export declare function parse(s:string):string"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, lib: decl}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if want == 0 || d.Code() != want {
				t.Fatalf("source kind %d: unexpected %s", kind, d.String())
			}
			if !strings.Contains(source[d.Pos():d.End()], "parse") {
				t.Fatalf("independent error span %q", source[d.Pos():d.End()])
			}
			count++
		}
		expected := 0
		if want != 0 {
			expected = 1
		}
		if count != expected {
			t.Fatalf("kind %d: want %d EK%04d, got %d", kind, expected, want, count)
		}
	})
}

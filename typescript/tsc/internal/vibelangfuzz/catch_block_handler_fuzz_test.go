package vibelangfuzz

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const catchBlockHandlerQuote = "For a malformed handler consisting of a parameter list followed directly by a block, as in `try x catch (e) { B }`, recovery reports `EK0509` and does not additionally report `EK0505` for that same expression."

func TestCatchBlockHandlerQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", catchBlockHandlerQuote)
}

// A parameter list followed directly by a block is EK0509, never the "'=>'
// expected" syntax error TypeScript's recovery gives: a syntax error hides
// every other diagnostic in the file, and chapter 2 keeps independent
// source-context and checking diagnostics. Each variant names the exact
// error codes it must report (EK codes as EKnnnn, TypeScript's as TSnnnn).
func FuzzCatchBlockHandler(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", catchBlockHandlerQuote)
	const head = "import { Effect } from \"effect\"\n"
	variants := []struct {
		key, source string
		want        []string
		handlers    int // handlers written as a parameter list and a block
	}{
		{"value", "export effect function f() { return Effect.fail(\"x\") catch (e) { return 0 } }", []string{"EK0509"}, 1},
		{"try-head", "export effect function f() { return try Effect.fail(\"x\") catch (e) { return 0 } }", []string{"EK0509"}, 1},
		{"typed-parameter", "export effect function f() { return Effect.fail(\"x\") catch (e: string) { return e.length } }", []string{"EK0509"}, 1},
		{"no-parameter", "export effect function f() { return Effect.fail(\"x\") catch () { return 1 } }", []string{"EK0509"}, 1},
		{"destructured-parameter", "export effect function f() { return Effect.fail(new Error(\"x\")) catch ({ message }) { return message } }", []string{"EK0509"}, 1},
		{"declaration", "export effect function f() { const n = Effect.fail(\"x\") catch (e) { return 0 }; return n }", []string{"EK0509"}, 1},
		{"chained", "export effect function f() { return Effect.fail(\"x\") catch (e) { return Effect.fail(1) } catch (e) => 2 }", []string{"EK0509"}, 1},
		{"plain-function", "export function f() { return Effect.fail(\"x\") catch (e) { return 0 } }", []string{"EK0504", "EK0509"}, 1},
		{"other-error-kept", "export effect function f() { const n: number = \"s\"; return Effect.fail(\"x\") catch (e) { return n } }", []string{"EK0509", "TS2322"}, 1},
		{"two-handlers", "export effect function f() { const a = Effect.fail(\"x\") catch (e) { return 0 }; const b = Effect.fail(\"y\") catch (e) { return 1 }; return [a, b] }", []string{"EK0509"}, 2},
	}
	keys := make([]string, len(variants))
	for i, v := range variants {
		keys[i] = v.key
		f.Add([]byte(v.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i, _ := keyedChoice(keys, data)
		v := variants[i]
		source := head + v.source
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var got []string
		ek0509 := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			code := fmt.Sprintf("TS%d", d.Code())
			if IsEK(d) {
				code = fmt.Sprintf("EK%04d", d.Code())
			}
			if code == "EK0509" {
				ek0509++
			}
			if !slices.Contains(got, code) {
				got = append(got, code)
			}
		}
		slices.Sort(got)
		want := slices.Sorted(slices.Values(v.want))
		if !slices.Equal(got, want) || ek0509 != v.handlers {
			Gap(t, "FuzzCatchBlockHandler", "codes:"+v.key, "%s; want %v (EK0509 once per handler), got %v\n%s", catchBlockHandlerQuote, want, Keys(r.Dir, r.Diagnostics), source)
		}
	})
}

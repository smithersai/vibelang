package vibelangfuzz

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const restoreConcurrentCaptureQuote = "`restore { }` that captures an outer mask across an independent `effect` function declaration/expression, arrow, method, producer or block"

const restoreConcurrentOwnMaskQuote = "A nested effect callable or `effect` block may introduce its own `uninterruptible` mask and restore that one."

func TestRestoreConcurrentCaptureQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", restoreConcurrentCaptureQuote)
	chapterSays(t, "002-running.md", restoreConcurrentOwnMaskQuote)
}

type restoreConcurrentCaptureCase struct {
	key, source, want string
}

func restoreConcurrentCaptureCases() []restoreConcurrentCaptureCase {
	forms := []struct{ key, statement, head string }{
		{"arrow", "const nested = effect () => { %s };", ""},
		{"function", "effect function nested() { %s }", ""},
		{"function-expression", "const nested = effect function () { %s };", ""},
		{"method", "class Nested { effect run() { %s } }", ""},
		{"block", "const nested = effect { %s };", ""},
		{"producer", "effect function* nested() { %s; yield 1 }", ""},
		{"head-arrow", "", "effect () => { %s }"},
		{"head-function", "", "effect function () { %s }"},
		{"head-block", "", "effect { %s }"},
	}
	wrapOuter := func(mode, body string) string {
		switch mode {
		case "mask":
			return "uninterruptible { " + body + " }"
		case "interruptible":
			return "uninterruptible { interruptible { " + body + " } }"
		default:
			return body
		}
	}
	wrapLoop := func(kind, binding, element, body string) string {
		if kind == "stream" {
			return "for try (" + binding + " of Stream.make(" + element + ")) { " + body + " }"
		}
		word := "for"
		if kind == "concurrent" {
			word += " concurrent"
		}
		return word + " (" + binding + " of [" + element + "]) { " + body + " }"
	}
	var cases []restoreConcurrentCaptureCase
	for _, form := range forms {
		for _, loop := range []string{"concurrent", "stream", "native"} {
			for _, outer := range []string{"none", "mask", "interruptible"} {
				for _, local := range []bool{false, true} {
					inner := "restore {}"
					if local {
						inner = "uninterruptible { restore {} }"
					}
					binding, element, body := "const item", "1", fmt.Sprintf(form.statement, inner)
					if form.head != "" {
						binding = "const [item = " + fmt.Sprintf(form.head, inner) + "]"
						element, body = "[undefined]", "void item;"
					}
					want := ""
					if !local {
						want = "EK2111"
						if outer != "none" {
							want = "EK2202"
						}
					}
					key := fmt.Sprintf("%s-%s-%s-local-%t", form.key, loop, outer, local)
					source := wrapOuter(outer, wrapLoop(loop, binding, element, body))
					cases = append(cases, restoreConcurrentCaptureCase{key, "import { Effect, Stream } from \"effect\"; export effect function outer() { " + source + " }", want})
				}
			}
		}
	}
	for _, loop := range []string{"concurrent", "stream", "native"} {
		for _, outer := range []string{"none", "mask", "interruptible"} {
			for _, local := range []bool{false, true} {
				body := "restore {}"
				if local {
					body = "uninterruptible { restore {} }"
				}
				want := ""
				if loop == "concurrent" {
					want = "EK2202"
				} else if !local && outer == "none" {
					want = "EK2111"
				}
				key := fmt.Sprintf("direct-%s-%s-local-%t", loop, outer, local)
				source := wrapOuter(outer, wrapLoop(loop, "const item", "1", body))
				cases = append(cases, restoreConcurrentCaptureCase{key, "import { Effect, Stream } from \"effect\"; export effect function outer() { " + source + " }", want})
			}
		}
	}
	return cases
}

// A concurrent item blocks direct restore, but must retain lexical mask
// ancestry for independent nested activations. Their own masks remain local.
// Sequential Stream and native items are controls for that boundary.
func FuzzRestoreConcurrentCapture(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", restoreConcurrentCaptureQuote)
	chapterSays(f, "002-running.md", restoreConcurrentOwnMaskQuote)
	cases := restoreConcurrentCaptureCases()
	keys := make([]string, len(cases))
	for i, c := range cases {
		keys[i] = c.key
		f.Add([]byte(c.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i, _ := keyedChoice(keys, data)
		c := cases[i]
		r, err := w.Compile(t.Context(), Single(c.source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var codes, want []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			code := fmt.Sprintf("TS%d", d.Code())
			if IsEK(d) {
				code = fmt.Sprintf("EK%04d", d.Code())
			}
			codes = append(codes, code)
		}
		if c.want != "" {
			want = []string{c.want}
		}
		slices.Sort(codes)
		if !slices.Equal(codes, want) {
			Gap(t, "FuzzRestoreConcurrentCapture", c.key, "%s; want %v, got %v\n%s", restoreConcurrentCaptureQuote, want, codes, c.source)
		}
	})
}

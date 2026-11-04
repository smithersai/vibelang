package vibelangfuzz

import (
	"fmt"
	"slices"
	"testing"
)

const streamConcurrentJumpQuote = "a labeled \u0060break\u0060 or \u0060continue\u0060 in head binding initialization or the body naming a statement that encloses the \u0060for try\u0060"

func TestStreamConcurrentJumpQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", streamConcurrentJumpQuote)
}

// Source labels remain visible across lowering callbacks, while written
// callables and each stream loop keep their own jump boundary.
func FuzzStreamConcurrentJump(f *testing.F) {
	startShortBudget(f)
	variants := []struct{ key, body, want string }{
		{"continue", "for try(const y of Stream.make(x)){continue own}", "EK2003"},
		{"break", "for try(const y of Stream.make(x)){break own}", "EK2003"},
		{"mask", "uninterruptible {for try(const y of Stream.make(x)){continue own}}", "EK2003"},
		{"native-loop", "for(const z of [1]){for try(const y of Stream.make(x)){continue own}}", "EK2003"},
		{"nested-item", "for concurrent(const z of [1]){for try(const y of Stream.make(x)){continue own}}", "EK2003"},
		{"local-stream", "local:for try(const y of Stream.make(x)){if(y)continue local;break local}", ""},
		{"local-native", "for try(const y of Stream.make(x)){local:for(const z of [1]){continue local}}", ""},
		{"source-callable", "effect function nested(){for try(const y of Stream.make(x)){continue own}}", "TS1107"},
	}
	keys := make([]string, len(variants))
	for i, v := range variants {
		keys[i] = v.key
		f.Add([]byte("key:" + v.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestStreamConcurrentJumpQuoted(t)
		v := variants[r3Pick(data, keys)]
		n := 0
		if len(data) > 0 {
			n = int(data[len(data)-1])
		}
		labels := []string{"own:", "own:alias:", "alias:own:"}
		limits := []string{"", "(1)", "(2)"}
		source := fmt.Sprintf("export effect function main(){%s for concurrent%s(const x of [1,2]){%s};return 7}", labels[n%3], limits[(n/3)%3], v.body)
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r3Errors(r.Diagnostics)
		bad := v.want == "" && len(errs) > 0 || v.want != "" && !slices.Contains(errs, v.want)
		if v.want == "EK2003" && slices.Contains(errs, "TS1107") {
			bad = true
		}
		if v.want == "TS1107" && slices.Contains(errs, "EK2003") {
			bad = true
		}
		if bad {
			Gap(t, "FuzzStreamConcurrentJump", "code:"+v.key, "chapter 2 says %q; expected %q, got %v", streamConcurrentJumpQuote, v.want, errs)
		}
	})
}

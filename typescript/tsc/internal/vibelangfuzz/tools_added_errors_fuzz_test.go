package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// This is an infrastructure reporting invariant, not a new language oracle:
// native TypeScript error counts still decide failure; the displayed witness
// must come from an unmatched diagnostic and carry its actual source span.
func FuzzToolsAddedErrorsEvidence(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"append", "prepend", "middle", "same-count", "remove", "duplicate-message"} {
		for _, mode := range []uint8{0, 2} {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		count := 1 + int(mode%3)
		base := "class Base { read(): number { return 1 } }\n"
		classes := func(prefix string, n int) string {
			var s strings.Builder
			for i := 0; i < n; i++ {
				fmt.Fprintf(&s, "class %s%d extends Base { read(): string { return 'wrong' } }\n", prefix, i)
			}
			return s.String()
		}
		original := base + classes("Old", count)
		next := original + classes("New", 1+int(mode/3%3))
		code := "TS2416"
		want := true
		switch key {
		case "append":
		case "prepend":
			next = base + classes("New", 1) + classes("Old", count)
		case "middle":
			next = base + classes("Old", 1) + classes("New", 1) + classes("OldTail", count-1)
			// Retain the original old names, so matching does not depend on position.
			original = base + classes("Old", 1) + classes("OldTail", count-1)
		case "same-count":
			next = base + classes("New", count)
			want = false
		case "remove":
			next = base
			want = false
		case "duplicate-message":
			original = "const first: number = 'wrong'\n"
			next = original + "const second: number = 'wrong'\n"
			code = "TS2322"
		default:
			key = "append"
		}
		compile := func(source string) *Result {
			t.Helper()
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": source}})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(r.Remove)
			return r
		}
		before, after := compile(original), compile(next)
		got := toolsAddedErrors(before, after)
		if !want {
			if len(got) != 0 {
				t.Fatalf("%s: changed count oracle: %v", key, got)
			}
			return
		}
		if len(got) < 2 || got[0] != "main.ts: "+code {
			t.Fatalf("%s: missing count delta/witness: %v", key, got)
		}
		text := strings.Join(got, "\n")
		if key != "duplicate-message" {
			if !strings.Contains(text, "'New") || strings.Contains(text, "'Old") {
				t.Fatalf("%s: selected an existing error:\n%s", key, text)
			}
		}
		var witness string
		for _, d := range after.Diagnostics {
			if key == "duplicate-message" && d.Pos() < len(original) {
				continue
			}
			if key != "duplicate-message" && !strings.Contains(d.String(), "'New") {
				continue
			}
			witness = fmt.Sprintf("at bytes %d..%d:", d.Pos(), d.End())
			break
		}
		if witness == "" || !strings.Contains(text, witness) {
			t.Fatalf("%s: missing the added diagnostic's span %q:\n%s", key, witness, text)
		}
	})
}

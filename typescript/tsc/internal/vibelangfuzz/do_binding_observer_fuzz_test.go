package vibelangfuzz

import (
	"maps"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func TestDoBindingObserverAfterJumpQuoted(t *testing.T) {
	chapterSays(t, "000-intro.md", doBindingTypesQuote)
}

// The observer is test infrastructure. Even when a preceding generated jump
// makes it unreachable, its TypeScript must remain valid independently of the
// destructuring-default behavior that the differential is meant to measure.
func FuzzDoBindingObserverAfterJump(f *testing.F) {
	startShortBudget(f)
	keys := []string{"reachable", "return", "throw", "break", "continue", "false"}
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	if err := installVIPEvents(w); err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		TestDoBindingObserverAfterJumpQuoted(t)
		index, _ := keyedChoice(keys, data)
		p := vipgen.Probe("vip02.do-binding-default-effect")
		source := vipgen.PrintVibe(p)
		start := strings.Index(source, "const bindingLog")
		if start < 0 {
			t.Fatal("generated default observer is missing")
		}
		end := start
		for range 3 {
			next := strings.IndexByte(source[end:], '\n')
			if next < 0 {
				t.Fatal("generated default observer is incomplete")
			}
			end += next + 1
		}
		observer := source[start:end]
		switch keys[index] {
		case "return":
			observer = "return 0;\n" + observer
		case "throw":
			observer = "throw \"skip\";\n" + observer
		case "break":
			observer = "while (false) { break;\n" + observer + "}\n"
		case "continue":
			observer = "while (false) { continue;\n" + observer + "}\n"
		case "false":
			observer = "if (false) {\n" + observer + "}\n"
		}
		files := maps.Clone(p.Files)
		files["main.vibe"] = source[:start] + observer + source[end:]
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if HasError(r.Diagnostics) {
			Gap(t, "FuzzDoBindingObserverAfterJump", "observer:"+keys[index], "%s\n%v\n%s", doBindingTypesQuote, SortedKeys(Keys(r.Dir, r.Diagnostics)), files["main.vibe"])
		}
	})
}

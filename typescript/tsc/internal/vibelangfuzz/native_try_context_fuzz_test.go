package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestNativeTryContextualReturnQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", catchCompletionAPIQuote)
	chapterSays(t, "002-running.md", nativeTryQuote)
}

// Static admission and declaration preservation follow the original return's
// contextual type. Runtime completion transport stays in the VIP differential.
func FuzzNativeTryContextualReturn(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"record", "tuple", "conditional", "generic"} {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		const target = "FuzzNativeTryContextualReturn"
		TestNativeTryContextualReturnQuoted(t)
		defer recoverCompilerPanic(t, target)
		ready := []string{"Ready", "Accepted", "Prêt"}[mode%3]
		number := fmt.Sprint(mode % 13)
		decl := fmt.Sprintf(`type Outcome = { tag: %q; value: number } | { tag: "Failed"; error: unknown };`, ready)
		body := fmt.Sprintf(`export effect function f(): Outcome!! { try { return { tag: %q, value: %s } } catch(error) { return { tag: "Failed", error } } }`, ready, number)
		switch key {
		case "tuple":
			decl = `type Pair = ["value", number];`
			body = fmt.Sprintf(`export effect function f(): Pair!! { try { return ["value", %s] } finally {} }`, number)
		case "conditional":
			body = fmt.Sprintf(`export effect function f(flag: boolean): Outcome!! { try { return flag ? { tag: %q, value: %s } : { tag: "Failed", error: null } } finally {} }`, ready, number)
		case "generic":
			decl = fmt.Sprintf(`type Outcome<T> = { tag: %q; value: T } | { tag: "Failed"; error: unknown };`, ready)
			body = fmt.Sprintf(`export effect function f<T>(value: T): Outcome<T>!! { try { return { tag: %q, value } } catch(error) { return { tag: "Failed", error } } }`, ready)
		default:
			key = "record"
		}
		source := decl + "\n" + body + "\n"
		if mode&4 != 0 {
			source = strings.ReplaceAll(source, "return ", "return /* returned value */ ")
		}
		if mode&8 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		before := toolsCompile(t, w, target, map[string]string{"main.vibe": source})
		defer before.Remove()
		foundNative := false
		for _, d := range before.Diagnostics {
			foundNative = foundNative || d.Code() == 503
		}
		if !foundNative {
			Gap(t, target, "diagnostic:"+key, "native try diagnostic missing: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		text := ""
		for path, file := range fixed.Files {
			if filepath.Base(path.AsString()) == "main.vibe" {
				text = file.Text
			}
		}
		if text == "" || strings.Contains(text, "try {") {
			Gap(t, target, "rewrite:"+key, "contextual return repair refused: %v", fixed.Refused)
		}
		after := toolsCompile(t, w, target, map[string]string{"main.vibe": text})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, target, "compile:"+key, "repair introduced errors: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
		}
		a, b := before.Outputs["out/main.d.ts"], after.Outputs["out/main.d.ts"]
		if a == "" || a != b {
			Gap(t, target, "declaration:"+key, "contextual return declaration changed:\nbefore %s\nafter %s", a, b)
		}
	})
}

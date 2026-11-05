package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func FuzzNativeGeneratorExceptionBoundary(f *testing.F) {
	startShortBudget(f)
	nativeGeneratorTeachingChapter(f)
	for mode := uint8(0); mode < 3; mode++ {
		f.Add(mode, uint8(7), false)
		f.Add(mode, uint8(31), true)
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	defer node.Close()
	f.Fuzz(func(t *testing.T, mode, value uint8, crlf bool) {
		n := int(value)
		body := fmt.Sprintf("return yield* Effect.succeed(%d)", n)
		switch mode % 3 {
		case 1:
			body = "return explode()"
		case 2:
			body = "return yield* Effect.fail(\"expected\")"
		}
		source := fmt.Sprintf("import { Effect } from \"effect\";\nimport { explode } from \"./native.js\";\nexport const main = () => Effect.gen(function* () { try { /* native boundary */ %s } catch { return %d } finally { /* finally stays */ } });\n", body, n+1)
		if crlf {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		foreign := "export function explode(): never { throw new Error(\"native\") }\n"
		twin := toolsCompile(t, w, "FuzzNativeGeneratorExceptionBoundary", map[string]string{"main.ts": source, "native.ts": foreign})
		defer twin.Remove()
		before := toolsCompile(t, w, "FuzzNativeGeneratorExceptionBoundary", map[string]string{"main.vibe": source, "native.ts": foreign})
		defer before.Remove()
		if HasError(twin.Diagnostics) || HasError(before.Diagnostics) {
			t.Fatalf("native control rejected: ts=%v vibe=%v", SortedKeys(Keys(twin.Dir, twin.Diagnostics)), SortedKeys(Keys(before.Dir, before.Diagnostics)))
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil || len(fixed.Sites) != 0 || len(fixed.Refused) != 0 {
			t.Fatalf("native exception boundary changed: error=%v files=%v sites=%+v refused=%+v", fixed.Err, fixed.Order, fixed.Sites, fixed.Refused)
		}
		text := source
		for name, file := range fixed.Files {
			if filepath.Base(name.AsString()) != "main.vibe" {
				t.Fatalf("changed foreign input: %s", name)
			}
			text = file.Text
		}
		boundary := source[strings.Index(source, "function*"):]
		if !strings.Contains(text, boundary) {
			t.Fatalf("native generator body changed:\n%s\nfixed:\n%s", source, text)
		}
		after := toolsCompile(t, w, "FuzzNativeGeneratorExceptionBoundary", map[string]string{"main.vibe": text, "native.ts": foreign})
		defer after.Remove()
		if HasError(after.Diagnostics) {
			t.Fatalf("repair adds diagnostics: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 || len(again.Sites) != 0 {
			t.Fatalf("second repair changes native boundary: %+v", again)
		}
		was := node.Run(twin, filepath.Join("out", "main.js"), "main")
		is := node.Run(after, filepath.Join("out", "main.js"), "main")
		if !toolsSameOutcome(was, is) {
			t.Fatalf("native outcome differs: ts=%+v vibe=%+v", was, is)
		}
		if mode%3 == 2 {
			if was.Kind != "failure" {
				t.Fatalf("yielded failure was caught as JavaScript: %+v", was)
			}
		} else {
			want := n
			if mode%3 == 1 {
				want++
			}
			if was.Kind != "success" || string(was.Value) != fmt.Sprint(want) {
				t.Fatalf("native catch result %+v, want %d", was, want)
			}
		}
	})
}

package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const effectAsyncConflictQuote = "`effect` and `async` on one function or block, in either order, is a compile error (`EK0105`; VIP-1/VIP-2)."

const effectAsyncAccessorQuote = "| `effect` on a getter, setter or constructor | `EK0104` |"

func effectAsyncConflictCited(t testing.TB) {
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{effectAsyncConflictQuote, effectAsyncAccessorQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("VIP-1 no longer says %q", quote)
		}
	}
}

func TestEffectAsyncConflictQuoted(t *testing.T) { effectAsyncConflictCited(t) }

func FuzzEffectAsyncConflict(f *testing.F) {
	startShortBudget(f)
	effectAsyncConflictCited(f)
	forms := []struct{ key, source string }{
		{"declaration", "%s function f() {}"}, {"export", "export %s function f() {}"},
		{"default", "export default %s function() {}"}, {"expression", "const f = %s function() {}"},
		{"producer", "%s function* f() {}"}, {"arrow", "const f = %s (x: number) => x"},
		{"bare", "const f = %s x => x"}, {"generic", "const f = %s <T>(x: T) => x"},
		{"statement-arrow", "%s (x: number) => x"}, {"statement-bare", "%s x => x"}, {"statement-generic", "%s <T>(x: T) => x"},
		{"block", "const f = %s { return 1 }"}, {"class", "class C { %s m() {} }"},
		{"object", "const f = { %s m() {} }"}, {"computed", "const f = { %s [\"m\"]() {} }"},
		{"static-producer", "class C { static %s *m() {} }"},
		{"class-getter", "class C { %s get value() { return 1 } }"},
		{"object-setter", "const c = { %s set value(v: number) {} }"},
		{"error-getter", "error E { %s get value() { return 1 } }"},
		{"schema-error-getter", "schema error E { %s get value() { return 1 } }"},
	}
	for _, form := range forms {
		f.Add(form.key, uint8(0), uint8(0))
		f.Add(form.key, uint8(1), uint8(1))
	}
	f.Fuzz(func(t *testing.T, key string, order, trivia uint8) {
		form := forms[int(order)%len(forms)]
		for _, candidate := range forms {
			if candidate.key == key {
				form = candidate
				break
			}
		}
		gap := []string{" ", " /* keep 😀 */ ", "\t", " /* a */ /* b */ "}[int(trivia)%4]
		prefix := "effect" + gap + "async"
		if order%2 == 1 {
			prefix = "async" + gap + "effect"
		}
		source := fmt.Sprintf(form.source, prefix)
		// The parser owns this error even with noCheck; no inferred type can
		// justify combining the explicit source kinds.
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
		ds := file.Diagnostics()
		want := 1
		if strings.Contains(form.key, "getter") || strings.Contains(form.key, "setter") {
			want = 2
		}
		codes := map[int32]int{}
		for _, d := range ds {
			if d.Source() == "EK" {
				codes[d.Code()]++
			}
		}
		if len(ds) != want || codes[105] != 1 || want == 2 && codes[104] != 1 {
			Gap(t, "FuzzEffectAsyncConflict", form.key, "%s; source %s; diagnostics %v", effectAsyncConflictQuote, source, ds)
		}
	})
}

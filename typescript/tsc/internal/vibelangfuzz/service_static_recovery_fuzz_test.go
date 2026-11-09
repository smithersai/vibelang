package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceStaticRecoveryQuote = "A member gets one diagnostic: the first row below that names it."
const serviceStaticRecoveryMemberQuote = "a body, an initializer, a modifier"

func serviceStaticRecoveryChapter(t testing.TB) string {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{serviceStaticRecoveryQuote, serviceStaticRecoveryMemberQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
	return string(text)
}

func TestServiceStaticRecoveryQuoted(t *testing.T) { serviceStaticRecoveryChapter(t) }

func FuzzServiceStaticRecovery(f *testing.F) {
	startShortBudget(f)
	chapter := serviceStaticRecoveryChapter(f)
	keys := []string{"method", "initializer", "getter", "setter", "symbol", "native", "valid-signature", "native-error", "untyped-static", "bodyless-static"}
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = keys[len(data)%len(keys)]
		}
		variant := byte(len(data))
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		instance, count := "", 2
		switch key {
		case "method", "native", "native-error", "untyped-static", "bodyless-static":
			instance = "run(): void {}"
		case "initializer":
			instance = "n = 1"
		case "getter":
			instance = "get n(): number { return 1 }"
		case "setter":
			instance = "set n(value: number) {}"
		case "symbol":
			instance = "[Symbol.iterator](): Iterator<number> { return [1][Symbol.iterator]() }"
		case "valid-signature":
			instance, count = "n: number", 1
		}
		static := []string{"static helper = 1", "static readonly helper = 1", "static helper(): void {}", "static get helper(): number { return 1 }"}[int(variant)%4]
		if key == "native-error" {
			static = "static helper = missing"
		}
		if key == "untyped-static" {
			static = "static helper"
		}
		if key == "bodyless-static" {
			static = "static helper(): void"
		}
		members := instance + "; " + static
		if variant&4 != 0 {
			members = static + "; " + instance
		}
		prefix := "export service S { static readonly key = \"static/S\"; "
		if key == "native" {
			prefix, count = "export class S { static readonly key = \"static/S\"; ", 0
		}
		r, err := w.Compile(t.Context(), Project{Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]},"files":["main.vibe"]}`, Files: map[string]string{"main.vibe": prefix + members + " }", "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		code, got := servicesRuleDiagnostic(chapter, serviceStaticRecoveryMemberQuote), 0
		native := 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == code {
				got++
			} else if key == "native-error" && d.Code() == 2304 {
				native++
			} else if d.Category() == diagnostics.CategoryError {
				t.Fatalf("fixture %s: %s", key, d.String())
			}
		}
		if key == "native-error" && native != 1 {
			Gap(t, "FuzzServiceStaticRecovery", key, "independent TS2304 was hidden")
			return
		}
		if got != count {
			Gap(t, "FuzzServiceStaticRecovery", key, "%s; want %d EK%04d, got %d", serviceStaticRecoveryQuote, count, code, got)
			return
		}
		ExpectPending(t, "FuzzServiceStaticRecovery", key)
		ExpectPending(t, "FuzzServiceStaticRecovery", specCorpusKey(t))
	})
}

package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const voidMatchFixTarget = "FuzzVoidMatchFix"
const voidMatchFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

// Alchemy's match-arm rewrite has a safe canonical value; Chapter 7 requires
// that applying it keep valid syntax and the original declaration. Inferred
// exports distinguish void from undefined, and a local undefined must not
// capture the replacement. The keyed source corpus is the migration witness.
func TestVoidMatchFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), voidMatchFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", voidMatchFixQuote)
	}
}

func FuzzVoidMatchFix(f *testing.F) {
	startShortBudget(f)
	f.Add("alchemy", byte(0))
	for _, key := range []string{"default", "statement", "inferred", "receiver"} {
		for variant := byte(0); variant < 16; variant++ {
			f.Add(key, variant)
		}
	}
	minimized, err := os.ReadFile(filepath.Join("testdata", "void-match-fix", "alchemy-catch-void-arm.vibe"))
	if err != nil {
		f.Fatal(err)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestVoidMatchFixQuoted(t)
		kinds := []string{"alchemy", "default", "statement", "inferred", "receiver"}
		if !slices.Contains(kinds, key) {
			if key == "" {
				key = "alchemy"
			} else {
				key = kinds[int(key[0])%len(kinds)]
			}
		}
		alias, member, shadow := "Effect", "void", false
		if variant&1 != 0 {
			member = "undefined"
		}
		if variant&2 != 0 {
			alias = "E"
		}
		shadow = variant&4 != 0
		header, params := "", "n: boolean"
		if alias == "E" {
			header = "import * as E from \"effect/Effect\"\n"
		}
		if shadow {
			params += ", undefined: number"
		}
		program := alias + "." + member
		commented := variant&8 != 0
		if commented {
			program = alias + " /* keep operand */ ." + member
		}

		body := "return match (n) { when true: try " + program + "; default: try " + program + "; }"
		source := header + "export effect function f(" + params + "): void!! {\n  " + body + "\n}\n"
		switch key {
		case "alchemy":
			source, program = string(minimized), "Effect.void"
			alias, member, shadow, commented = "Effect", "void", false, false
		case "default":
			source = header + "export effect function f(" + params + "): void!! {\n  match (n) { when true: 0; default: try " + program + "; }\n}\n"
		case "statement":
			source = header + "export effect function f(" + params + "): void!! {\n  match (n) { when true: try " + program + "; default: try " + program + "; }\n}\n"
		case "receiver":
			program = "read()." + member
			if commented {
				program = "read() /* keep operand */ ." + member
			}
			source = header + "let reads = 0\nfunction read() { reads++; return " + alias + " }\nexport effect function f(" + params + "): void!! {\n return match (n) { when true: try " + program + "; default: try " + program + "; }\n}\n"
		case "inferred":
			source = header + "export const f = effect (" + params + ") => match (n) { when true: try " + program + "; default: \"ok\"; }\n"
		}
		label := fmt.Sprintf("%s/%s/%s/shadow-%t", key, member, alias, shadow)
		if commented {
			label += "/commented"
		}
		keep := commented || key == "receiver"
		before, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if !toolsErrorFree(before) {
			Gap(t, voidMatchFixTarget, "source:"+label, "Chapter 7: %s; valid witness failed: %s\n%s", voidMatchFixQuote, Archive(before.Sources), source)
			return
		}
		config := toolsConfig(w, before.Dir)
		if config == nil || len(config.Errors) != 0 {
			t.Fatal("invalid fuzz fixture configuration")
		}
		result := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), config)
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		if len(result.Refused) != 0 || strings.Contains(fixed, "try "+program) != keep {
			Gap(t, voidMatchFixTarget, "arm-value:"+label, "Chapter 7: %s; the safe arm rewrite must retain an expression, not refuse malformed syntax: %+v\n%s", voidMatchFixQuote, result.Refused, fixed)
			return
		}
		after, err := w.Compile(t.Context(), Single(fixed))
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, voidMatchFixTarget, "fixed:"+label, "Chapter 7: %s; rewrite added an error:\n%s", voidMatchFixQuote, fixed)
			return
		}
		originalDeclaration, ok := before.Outputs["out/main.d.ts"]
		if !ok {
			t.Fatal("control emitted no declaration")
		}
		if originalDeclaration != after.Outputs["out/main.d.ts"] {
			Gap(t, voidMatchFixTarget, "declaration:"+label, "Chapter 7: %s; before:\n%s\nafter:\n%s\nsource:\n%s\nfixed:\n%s", voidMatchFixQuote, originalDeclaration, after.Outputs["out/main.d.ts"], source, fixed)
		}
	})
}

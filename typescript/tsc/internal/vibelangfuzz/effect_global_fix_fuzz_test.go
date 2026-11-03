package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const effectGlobalFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
const effectGlobalNameQuote = "A local declaration or import shadows one, as with any global."

func TestEffectGlobalFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), effectGlobalFixQuote) ||
		!strings.Contains(SpecText("../vips/0006-effect-globals.md"), effectGlobalNameQuote) {
		t.Fatal("Effect global fix oracle no longer quoted in Chapters 7/VIP-6")
	}
}

func FuzzEffectGlobalFix(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"alchemy", "sleep", "retry", "forEach"} {
		for variant := byte(0); variant < 8; variant++ {
			f.Add(key, variant)
		}
	}
	minimized, err := os.ReadFile(filepath.Join("testdata", "effect-global-fix", "alchemy-retry-held.vibe"))
	if err != nil {
		f.Fatal(err)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestEffectGlobalFixQuoted(t)
		if key != "alchemy" && key != "sleep" && key != "retry" && key != "forEach" {
			key = "sleep"
		}
		member, args := "sleep", `"1 millis"`
		switch key {
		case "retry", "alchemy":
			member, args = "retry", "Effect.succeed(1), { times: 2 }"
		case "forEach":
			member, args = "forEach", "[1, 2], (n) => Effect.succeed(n)"
		}
		receiver, header := "Effect", ""
		if variant&1 != 0 {
			receiver, header = "E", "import * as E from \"effect/Effect\"\n"
		}
		params := ""
		if variant&2 != 0 {
			params = member + ": number"
		}
		if variant&4 != 0 {
			header += "type " + member + " = string\n"
		}
		source := header + "export const f = (" + params + ") => " + receiver + "." + member + "(" + args + ")\n"
		if key == "alchemy" {
			source = string(minimized)
			receiver = "Effect"
		}
		label := fmt.Sprintf("%s/%d", key, variant)
		before, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if !toolsErrorFree(before) {
			Gap(t, "FuzzEffectGlobalFix", "source:"+label, "VIP-6 valid source failed: %s", source)
			return
		}
		config := toolsConfig(w, before.Dir)
		if config == nil || len(config.Errors) != 0 {
			t.Fatal("invalid fixture")
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
		qualified := receiver + "." + member + "("
		shadow := variant&2 != 0 && key != "alchemy"
		if len(result.Refused) != 0 || strings.Contains(fixed, qualified) != shadow {
			Gap(t, "FuzzEffectGlobalFix", "binding:"+label, "VIP-6: %s; qualified=%t shadow=%t refused=%+v\n%s", effectGlobalNameQuote, strings.Contains(fixed, qualified), shadow, result.Refused, fixed)
			return
		}
		after, err := w.Compile(t.Context(), Single(fixed))
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzEffectGlobalFix", "fixed:"+label, "Chapter 7: %s; invalid rewrite\n%s", effectGlobalFixQuote, fixed)
			return
		}
		declaration, ok := before.Outputs["out/main.d.ts"]
		if !ok {
			t.Fatal("missing control declaration")
		}
		if declaration != after.Outputs["out/main.d.ts"] {
			Gap(t, "FuzzEffectGlobalFix", "declaration:"+label, "Chapter 7: %s; before %s; after %s", effectGlobalFixQuote, declaration, after.Outputs["out/main.d.ts"])
		}
	})
}

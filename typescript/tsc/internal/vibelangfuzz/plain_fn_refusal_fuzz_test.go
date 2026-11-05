package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const plainFnRefusalQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestPlainFnRefusalQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), plainFnRefusalQuote) {
		t.Fatal("Chapter 7 changed its refusal rule")
	}
}

var plainFnRefusalKeys = []string{
	"direct-arrow", "direct-block", "direct-function",
	"named-arrow", "named-block", "named-function",
	"options-arrow", "options-block", "options-function",
}

// A refusal preserves the unsupported callback's whole call while independent
// generator repairs remain available. Inputs select a keyed shape, then mutate
// its alias and arithmetic operand while retaining a callback comment.
func FuzzPlainEffectFnRefusal(f *testing.F) {
	startShortBudget(f)
	for _, key := range plainFnRefusalKeys {
		f.Add(key)
		f.Add(key + ":call")
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string) {
		if !strings.Contains(SpecText("007-tooling.md"), plainFnRefusalQuote) {
			t.Fatal("refusal quote changed")
		}
		key, extra, _ := strings.Cut(input, ":")
		index := -1
		for i, candidate := range plainFnRefusalKeys {
			if key == candidate {
				index = i
				break
			}
		}
		variant := byte(0)
		for i := range len(extra) {
			variant ^= extra[i]
		}
		if index < 0 {
			if len(input) > 0 {
				variant ^= input[0]
			}
			index = int(variant) % len(plainFnRefusalKeys)
			key = plainFnRefusalKeys[index]
		}
		callee := []string{"E.fn", "E.fn(\"work\")", "E.fn(\"work\", { attributes: { operation: \"proof\" } })"}[index/3]
		parameter, value := "n: number", "n"
		immediate := variant&2 != 0
		if immediate {
			parameter, value = "n: () => number", "n()"
		}
		expression := fmt.Sprintf("E.succeed(%s + %d)", value, int(variant)%17)
		callback := []string{
			"(" + parameter + ") => " + expression,
			"(" + parameter + ") => { return " + expression + " }",
			"function(" + parameter + ") { return " + expression + " }",
		}[index%3]
		call := callee + "(/* callback */ " + callback + ")"
		initializer := call
		if immediate {
			initializer += "(() => 1)"
		}
		prefix := "import { Effect as E } from \"effect\"\n"
		if variant%2 != 0 {
			prefix = "import * as E from \"effect/Effect\"\n"
		}
		source := prefix + "export const work = " + initializer + "\nexport const control = E.fn(function*(n: number) { return n + 1 })\n"
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, "FuzzPlainEffectFnRefusal", files)
		defer before.Remove()
		if !toolsErrorFree(before) {
			t.Fatalf("valid callback did not compile: %s", source)
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := source
		for name, file := range result.Files {
			if strings.HasSuffix(name.AsString(), "/main.vibe") {
				fixed = file.Text
			}
		}
		count := 0
		for _, site := range result.Sites {
			if site.Code == "EK1002" && strings.Contains(site.Reason, "not an inline generator") {
				count++
				if !vibelang.SiteHolds(source, fixed, site) || strings.TrimSpace(source[site.Start:site.End]) != call {
					Gap(t, "FuzzPlainEffectFnRefusal", key, "Chapter 7: refused callback changed: %+v\n%s", site, fixed)
				}
			}
		}
		if count != 1 || len(result.Changed) != 0 || !strings.Contains(fixed, call) {
			Gap(t, "FuzzPlainEffectFnRefusal", key, "Chapter 7: missing preserving refusal: %+v\n%s", result.Sites, fixed)
		}
		if strings.Contains(fixed, "E.fn(function*") {
			Gap(t, "FuzzPlainEffectFnRefusal", key, "independent generator repair disappeared: %s", fixed)
		}
		ExpectPending(t, "FuzzPlainEffectFnRefusal", key)
	})
}

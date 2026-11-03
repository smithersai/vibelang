package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const nothrowPreservingTarget = "FuzzNothrowPreservingFix"

var nothrowPreservingQuotes = []string{
	"or move the code to a `.ts` file.",
	"A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output",
}

func TestNothrowPreservingQuoted(t *testing.T) {
	for i, q := range nothrowPreservingQuotes {
		chapter := "003-failures.md"
		if i == 1 {
			chapter = "007-tooling.md"
		}
		if !strings.Contains(SpecText(chapter), q) {
			t.Fatalf("%s no longer says %q", chapter, q)
		}
	}
}

func FuzzNothrowPreservingFix(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"statement", "caught", "callback", "default", "generator", "effect-result", "smithers-Store-Effect-try"} {
		f.Add(key, int8(7))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, value int8) {
		toolsGuard(t, nothrowPreservingTarget, func() {
			operand := fmt.Sprintf("/*operand*/ (%d + marker)", value)
			prefix := "const marker=1;\n"
			var source string
			switch key {
			case "caught":
				source = "export function main():number {try {throw " + operand + "} catch(e) {return marker}}"
			case "callback":
				source = "export function main():number {return [1].map((n):number=>{throw " + operand + "})[0]}"
			case "default":
				source = "export function main(n=throw " + operand + "):number {return n}"
			case "generator":
				source = "export function* main():Generator<number> {yield marker; throw " + operand + "}"
			case "effect-result":
				source = "export function main():Effect.Effect<number> {throw " + operand + "}"
			case "smithers-Store-Effect-try":
				source = "export function main(field:string):Effect.Effect<string,unknown> {return Effect.try({try:()=>{const text=JSON.stringify(undefined);if(text===undefined) throw new TypeError(field);return text},catch:(e)=>e})}"
			default:
				key = "statement"
				source = "export function main():number {throw " + operand + "}"
			}
			source = prefix + source
			files := map[string]string{"main.vibe": source}
			before := toolsCompile(t, w, nothrowPreservingTarget, files)
			defer before.Remove()
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			for _, site := range result.Sites {
				if !vibelang.SiteHolds(source, fixed["main.vibe"], site) {
					Gap(t, nothrowPreservingTarget, key+":refused-bytes", "refused site changed: %+v", site)
				}
			}
			if len(result.Changed) > 0 {
				Gap(t, nothrowPreservingTarget, key+":changed", "fix changed refused sites: %+v", result.Changed)
			}
			if key == "effect-result" {
				if strings.Contains(fixed["main.vibe"], "$raise(") || strings.Contains(fixed["main.vibe"], "effect function main") || len(result.Sites) == 0 {
					Gap(t, nothrowPreservingTarget, key, "strict Effect result must refuse the TS-throw repair")
				}
				return
			}
			if !strings.Contains(fixed["main.vibe"], "export function raise(value: unknown): never { throw value }") {
				Gap(t, nothrowPreservingTarget, key+":missing", "missing TypeScript throw boundary:\n%s", fixed["main.vibe"])
			}
			if key != "smithers-Store-Effect-try" && !strings.Contains(fixed["main.vibe"], operand) {
				Gap(t, nothrowPreservingTarget, key+":operand", "operand/comments changed:\n%s", fixed["main.vibe"])
			}
			after := toolsCompile(t, w, nothrowPreservingTarget, fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, nothrowPreservingTarget, key+":diagnostics", "fixed program has errors: %+v", after.Diagnostics)
			}
		})
	})
}

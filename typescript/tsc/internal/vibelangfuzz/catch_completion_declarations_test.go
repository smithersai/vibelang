package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const catchCompletionAPIQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func TestCatchCompletionDeclarationsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", catchCompletionAPIQuote)
	chapterSays(t, "002-running.md", nativeTryScaffoldQuote)
}

func FuzzCatchCompletionDeclarations(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "007-tooling.md", catchCompletionAPIQuote)
	for mode := range uint8(8) {
		f.Add(mode)
	}
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "vibelang", "cases", "decl-catch", "main.vibe"))
	if err != nil {
		f.Fatal(err)
	}
	w := NewWorkspace(f)
	tsc := annotationTwinTypeScript(f)
	f.Fuzz(func(t *testing.T, mode uint8) {
		mode %= 8
		text := string(source) + "\nexport { rethrow }\n"
		if mode&1 != 0 {
			text = strings.ReplaceAll(text, "Busy", "Occupied")
		}
		if mode&2 != 0 {
			text = "// Completion declaration control.\n" + text
		}
		if mode&4 != 0 {
			text = strings.ReplaceAll(text, "\n", "\r\n")
		}
		r := toolsCompile(t, w, "FuzzCatchCompletionDeclarations", map[string]string{"main.vibe": text})
		defer r.Remove()
		if !toolsErrorFree(r) {
			Gap(t, "FuzzCatchCompletionDeclarations", fmt.Sprint(mode), "%s: %v", catchCompletionAPIQuote, SortedKeys(Keys(r.Dir, r.Diagnostics)))
			return
		}
		declaration := r.Outputs["out/main.d.ts"]
		if declaration == "" {
			t.Fatal("missing declaration")
		}
		check := `import { Effect } from "effect"
import { main, rethrow } from "./fixed.js"
type Success<T> = T extends Effect.Effect<infer A, infer E, infer R> ? A : never
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
export const literalReturns: Same<Success<ReturnType<typeof rethrow>>, "none" | "wrongly caught" | "rethrown"> = true
export const fields: Same<Success<ReturnType<typeof main>>, { a: string; b: string; c: string; d: string; e: "none" | "wrongly caught" | "rethrown"; f: string; g: string }> = true
`
		out, ok := runAnnotationTwinTSC(t, w, tsc, map[string]string{"fixed.d.ts": declaration, "check.ts": check}, `"fixed.d.ts", "check.ts"`)
		if !ok {
			Gap(t, "FuzzCatchCompletionDeclarations", fmt.Sprint(mode), "%s\n%s\n%s", catchCompletionAPIQuote, out, declaration)
		}
	})
}

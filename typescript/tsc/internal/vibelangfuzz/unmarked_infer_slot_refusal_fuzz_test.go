package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const unmarkedInferSlotRefusalTarget = "FuzzUnmarkedInferSlotRefusal"
const unmarkedInferSlotRefusalQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestUnmarkedInferSlotRefusalQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), unmarkedInferSlotRefusalQuote) {
		t.Fatal("missing preserving quick-fix rule")
	}
}

// Mutate the callable form, the incompatible written channel and trivia.
// Filling the remaining infer slot cannot repair a conflicting written type.
func FuzzUnmarkedInferSlotRefusal(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"function", "expression", "arrow", "object-method", "class-method"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestUnmarkedInferSlotRefusalQuoted(t)
		annotation, result := "Effect.Effect<string, infer E>", "Effect.succeed(1)"
		if mode&1 != 0 {
			annotation, result = "Effect.Effect<infer A, string>", "Effect.fail(1)"
		}
		var source string
		switch key {
		case "expression":
			source = fmt.Sprintf("export const p = function(): %s { return %s }", annotation, result)
		case "arrow":
			source = fmt.Sprintf("export const p = (): %s => %s", annotation, result)
		case "object-method":
			source = fmt.Sprintf("export const p = { run(): %s { return %s } }", annotation, result)
		case "class-method":
			source = fmt.Sprintf("export class P { run(): %s { return %s } }", annotation, result)
		default:
			key = "function"
			source = fmt.Sprintf("export function p(): %s { return %s }", annotation, result)
		}
		source += "\n"
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, ": ", ": /* written channel */ ")
		}
		if mode&4 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{"main.vibe": source}
		toolsGuard(t, unmarkedInferSlotRefusalTarget, func() {
			original := toolsCompile(t, w, unmarkedInferSlotRefusalTarget, files)
			defer original.Remove()
			plans, _, seen := quickfixEditorPlans(t, w, original, files, []int32{4857})
			if !seen[4857] || len(plans) != 0 {
				Gap(t, unmarkedInferSlotRefusalTarget, fmt.Sprintf("refusal:%s:%d", key, mode&1),
					"%s; seen=%v offered=%d\n%s", unmarkedInferSlotRefusalQuote, seen, len(plans), source)
			}
		})
	})
}

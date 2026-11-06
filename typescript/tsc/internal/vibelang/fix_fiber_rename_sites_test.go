package vibelang

import (
	"strings"
	"testing"
)

const renameSiteFile = `export type Plain = Effect.Effect<number>
export const a = Effect.gen(function* () {
  yield* Effect.void
  return join("a", "b")
})
export type Other = Effect.Effect<string>
export const b = Effect.gen(function* () {
  yield* Effect.void
  return join("c", "d")
})
`

// A rename's uses are separate sites. Its refusal holds them, and a fix of the
// code between them still applies: an error that names the binding changes its
// text under the rename, so an early round refuses it.
func TestRefusedRenameHoldsItsUsesAndNothingBetween(t *testing.T) {
	result := fixProjectOf(t, map[string]string{
		"lib.ts":    "/** @throws {RangeError} */\nexport function join(a: string, b: string): string { return a + b }\n",
		"main.vibe": "import { Effect } from \"effect\"\nimport { join } from \"./lib.ts\"\nexport function plain() { return join(\"p\", \"q\") }\n" + renameSiteFile,
	})
	got := fixedText(result, "main.vibe")
	if result.Err != nil || !strings.Contains(got, "export type Other = string!!") {
		t.Fatalf("the fix between two uses was blocked: %v %+v\n%s", result.Err, result.Sites, got)
	}
	for _, refusal := range result.Refused {
		if refusal.Label != fiberNameRenameLabel {
			continue
		}
		if !refusal.Spanned || refusal.End-refusal.Start > len("join") {
			t.Fatalf("a refusal spans text the rename does not edit: %+v", refusal)
		}
	}
	if len(result.Changed) != 0 {
		t.Fatalf("a refused site changed: %+v", result.Changed)
	}
}

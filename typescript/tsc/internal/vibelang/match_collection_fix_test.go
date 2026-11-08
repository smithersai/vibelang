package vibelang

import (
	"testing"
)

func TestCollectionExtractorDeclaredCustomMatcher(t *testing.T) {
	source := `declare global {
  interface MapConstructor {
   [customMatcher](subject: unknown, hint: { matchType: "boolean" | "extractor" }): readonly [string]
  }
 }
 export function read(s: Map<string, number>): string {
  return match(s) { when Map(let m): m; default: "fallback"; }
 }`
	if ds := errorsOf(t, source); len(ds) != 0 {
		t.Fatalf("declared own matcher lost: %v", ds)
	}
}

package vibelangmapper

import (
	"strings"
	"testing"
)

// VIP-7 cache bookkeeping must leave valid patterns checkable by stock
// TypeScript, including the private helper imported by their projection.
func TestMatchCachePreludeStock(t *testing.T) {
	for name, source := range map[string]string{
		"object arms":        "export function select(s: {value: number}): number { return match(s) { when {value: 0}: 0; when {let value}: value; default: -1; } }",
		"object predicate":   "export function accepts(s: unknown): boolean { return s is {value: 1} }",
		"captured predicate": "export function select(s: unknown): unknown { return (s is {value: let value}) ? value : undefined }",
		"computed property":  "const key = \"value\"; export function select(s: {value: number}): number { return match(s) { when {[key]: Number(let value)}: value; default: 0; } }",
		"iterable arms":      "export function select(s: readonly number[]): number { return match(s) { when [0]: 0; when [let value]: value; default: -1; } }",
	} {
		t.Run(name, func(t *testing.T) {
			decl, output, err := catchTagStock(t, source)
			if err != nil {
				t.Fatalf("stock TypeScript rejected cached pattern: %v\n%s", err, output)
			}
			if !strings.Contains(decl, "export declare function") {
				t.Fatalf("missing public declaration:\n%s", decl)
			}
			if strings.Contains(decl, "$matchCache") {
				t.Fatalf("private cache leaked into public declaration:\n%s", decl)
			}
		})
	}
}

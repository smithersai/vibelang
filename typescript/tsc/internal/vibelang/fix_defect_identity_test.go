package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefectBridgeMapperIsNonthrowing(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ name, prefix, body string }{
		{"ordinary", "", "export effect function value(n: number) { return double(n) }\n"},
		{"generator", "", "export const value = (n: number) => Effect.gen(function* () { return double(n) })\n"},
		{"top-level name", "export const identity = 1\n", "export effect function value(n: number) { return double(n) }\n"},
		{"parameter name", "", "export effect function value(identity: number) { return double(identity) }\n"},
		{"existing alias", "import { identity as preserve } from \"effect/Function\"\nvoid preserve\n", "export effect function value(n: number) { return double(n) }\n"},
		{"shadowed alias", "import { identity as preserve } from \"effect/Function\"\nvoid preserve\n", "export effect function value(preserve: number) { return double(preserve) }\n"},
		{"namespace name", "export const Function = 1\n", "export effect function value(n: number) { return double(n) }\n"},
		{"several repairs", "", "export effect function value(n: number) { const a = double(n); const b = double(n + 1); const c = double(n + 2); return [a,b,c] }\n"},
		{"escaped top-level name", "export const \\u0069dentity = 1\n", "export effect function value(n: number) { return double(n) }\n"},
		{"escaped parameter name", "", "export effect function value(\\u0069dentity: number) { return double(\\u0069dentity) }\n"},
		{"type-only import", "import type { identity } from \"effect/Function\"\n", "export effect function value(n: number) { return double(n) }\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/ek4401-fix.fail"), root)
			source := "import { double } from \"./plain.ts\"\n" + test.prefix + test.body
			if err := os.WriteFile(filepath.Join(dir, "lib.vibe"), []byte(source), 0644); err != nil {
				t.Fatal(err)
			}
			result := fixCase(t, dir)
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("bridge refused: err=%v refused=%+v", result.Err, result.Refused)
			}
			var got string
			for name, fixed := range result.Files {
				if filepath.Base(name.AsString()) == "lib.vibe" {
					got = fixed.Text
				}
			}
			if !strings.Contains(got, "catch: (e) => e") {
				t.Fatalf("generated catch mapper must be provably nonthrowing:\n%s", got)
			}
			if strings.Count(got, "effect/Function") != strings.Count(source, "effect/Function") || !strings.Contains(got, test.prefix) {
				t.Fatalf("bridge must leave existing imports and bindings alone:\n%s", got)
			}
			for name, fixed := range result.Files {
				if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0644); err != nil {
					t.Fatal(err)
				}
			}
			again := fixCase(t, dir)
			if again.Err != nil || len(again.Files) != 0 {
				t.Fatalf("bridge is not stable: err=%v files=%v", again.Err, again.Order)
			}
		})
	}
}

func TestDefectBridgeOpencodeFixTwin(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "typescript/vibelang/cases/ek0403-inline-catch.fail")
	twin := filepath.Join(root, "typescript/vibelang/cases/ek0403-inline-catch-fixed")
	want, err := os.ReadFile(filepath.Join(twin, "main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, copyCompilerFixture(t, fixture, root))
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("fix: %v; refused: %v", result.Err, result.Refused)
	}
	var got string
	for name, fixed := range result.Files {
		if filepath.Base(name.AsString()) == "main.vibe" {
			got = fixed.Text
		}
	}
	if got != "// expect: EK0403\n"+string(want) {
		t.Fatalf("fix writes:\n%s\nwant:\n%s", got, want)
	}
}

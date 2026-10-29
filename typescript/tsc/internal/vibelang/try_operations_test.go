package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestTryOperationObjectFix(t *testing.T) {
	source := "export function main() { return try.all { n: Effect.succeed(1) } }"
	want := "import { all as $tryAllEffects } from \"effect/Effect\"\nexport function main() { return (try $tryAllEffects({ n: Effect.succeed(1) }, { concurrency: \"unbounded\" })) }"
	got := applyQuickFixOf(t, source, EK1801.Code, diagnostics.CategoryError)
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestTryOperationObjectFixShadowedAll(t *testing.T) {
	source := "// file comment\n\"use client\";\nconst all = 0; const $tryAllEffects = 1; export function main() { return try.all { n: Effect.succeed(1) } }"
	got := applyQuickFixOf(t, source, EK1801.Code, diagnostics.CategoryError)
	if !strings.HasPrefix(got, "// file comment\n\"use client\";\nimport { all as $tryAllEffects_ } from \"effect/Effect\"") || !strings.Contains(got, "(try $tryAllEffects_({ n: Effect.succeed(1) }") {
		t.Fatal(got)
	}
}

package main

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func TestGeneratedSourcesUseExplicitEffects(t *testing.T) {
	sources := generatedSources(vipgen.Seed("vip01.effect-function"))
	if len(sources) == 0 || !strings.Contains(sources[0], "effect function ") {
		t.Fatalf("expected a generated explicit Effect function: %q", sources)
	}
	for _, source := range sources {
		if got := parse(source); !got.Valid {
			t.Fatalf("generator supplied invalid source: %v\n%s", got.Diagnostics, source)
		}
	}
}

package vibelangfuzz

import (
	"strings"
	"testing"
)

var nativeFactoryPhaseKeys = []string{"held-priority", "held-zero-yield", "held-interrupt", "plain-factory", "top-level", "async-factory", "argument", "array", "conditional", "spread", "optional", "inner-return", "run-yield", "run-interrupt"}

func nativeFactoryPhaseQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite.") {
		t.Fatal("Chapter 7 quick-fix preservation rule moved")
	}
	if !strings.Contains(SpecText("005-services.md"), "The non-function value exports are globals too") {
		t.Fatal("Chapter 5 native Effect values rule moved")
	}
}

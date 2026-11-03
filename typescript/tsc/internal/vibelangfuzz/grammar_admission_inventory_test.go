package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/grammaradmission"
)

// TestGrammarAdmissionInventory is in the fast spec gate. A new parser hook or
// lowering cannot land without an explicit row; duplicate rows and invented
// Appendix A production names fail too. A row whose hook is gone is only
// reported: main reverts land under time pressure, and a kept row lets a
// revert that restores its hook pass without editing this table.
func TestGrammarAdmissionInventory(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(repoTestdata(), "grammar_admission.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	hooks, err := grammaradmission.Hooks(Root())
	if err != nil {
		t.Fatal(err)
	}
	errs, stale := grammaradmission.Check(hooks, string(data), SpecPath)
	for _, e := range errs {
		t.Error(e)
	}
	for _, hook := range stale {
		t.Logf("row for a removed hook (kept for reverts; delete when the removal is final): %s", hook)
	}
	t.Logf("%d parser/support and lowering hooks accounted for", len(hooks))
}

// A revert in either direction passes: a removed hook leaves a stale row,
// and restoring the hook finds it again. Only a hook with no row fails.
func TestGrammarAdmissionInventoryReverts(t *testing.T) {
	rows := "parser/vibelang_a.go:Parser.a\tadmission:a\t900-appendices.md\tsupport\tr\n" +
		"parser/vibelang_gone.go:Parser.gone\tadmission:gone\t-\tpending\tr\n"
	errs, stale := grammaradmission.Check(map[string]bool{"parser/vibelang_a.go:Parser.a": true, "parser/vibelang_new.go:Parser.added": true}, rows, SpecPath)
	if len(errs) != 1 || !strings.Contains(errs[0], "unaccounted syntax/lowering hook parser/vibelang_new.go:Parser.added") {
		t.Fatalf("a hook with no row must fail alone: %q", errs)
	}
	if len(stale) != 1 || stale[0] != "parser/vibelang_gone.go:Parser.gone" {
		t.Fatalf("a removed hook's row must be reported, not failed: %q", stale)
	}
}

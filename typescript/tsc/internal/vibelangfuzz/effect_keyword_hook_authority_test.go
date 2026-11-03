package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/grammaradmission"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The named helper implements the inherited keyword rule. Its support row
// describes that authority even when the source fix and census land apart.
func TestEffectKeywordHookAuthorityQuoted(t *testing.T) {
	const quote = "`effect` goes exactly where TypeScript allows `async`, and nowhere else (VIP-1)"
	spec, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(spec), quote) {
		t.Fatalf("chapter001 no longer says %q", quote)
	}
	const hook = "parser/vibelang_effect.go:Parser.consumeVibeLangEffectWord"
	table := filepath.Join(filepath.Dir(SpecPath("900-appendices.md")), "../../..", grammaradmission.Table)
	data, err := os.ReadFile(table)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) != 5 || fields[0] != hook {
			continue
		}
		found = true
		if fields[3] != "support" || !strings.Contains(fields[2], "001-functions.md") {
			t.Errorf("keyword consumption must cite its existing lexical rule as support: %s", line)
		}
	}
	if !found {
		t.Errorf("missing lexical authority for %s", hook)
	}
	errs, _ := grammaradmission.Check(map[string]bool{hook: true}, string(data), SpecPath)
	for _, err := range errs {
		t.Error(err)
	}
}

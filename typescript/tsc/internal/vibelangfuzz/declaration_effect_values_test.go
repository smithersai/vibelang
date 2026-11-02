package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestDeclarationEffectValuesQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"000-intro.md":     "TypeScript's meaning outside Effect code.",
		"001-functions.md": "Declarations are exactly what idiomatic Effect TypeScript would declare.",
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// Opencode's Random value, aliased Clock and Schema decoder must retain the
// declarations stock TypeScript emits, including its import-type spelling.
// Every corpus input is also replayed by the existing FuzzDeclarationIdentity.
func TestDeclarationEffectValueImports(t *testing.T) {
	TestDeclarationEffectValuesQuoted(t)
	tsc, api := StockTypeScript(t), declarationIdentityAPI(t)
	w := NewWorkspace(t)
	for _, family := range []string{"random", "clock", "decoder"} {
		for _, form := range []string{"named", "renamed", "type-only"} {
			name := "opencode-effect-value-" + family + "-" + form
			t.Run(name, func(t *testing.T) {
				data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzDeclarationIdentity", name))
				if err != nil {
					t.Fatal(err)
				}
				lines := strings.Split(strings.TrimSpace(string(data)), "\n")
				if len(lines) != 2 || lines[0] != "go test fuzz v1" || !strings.HasPrefix(lines[1], "string(") || !strings.HasSuffix(lines[1], ")") {
					t.Fatal("expected one keyed declaration-identity archive")
				}
				archive, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "string("), ")"))
				if err != nil {
					t.Fatal(err)
				}
				report := filepath.Join(t.TempDir(), "declaration-diff.jsonl")
				t.Setenv("VIBELANG_FUZZ_DECLARATION_REPORT", report)
				// A malformed native control or broad pending key must not hide this
				// previously repaired witness. Missing dependencies are handled above.
				t.Cleanup(func() {
					if t.Skipped() {
						data, err := os.ReadFile(report)
						var record struct{ Diff string }
						if err == nil && json.Unmarshal(data, &record) == nil && record.Diff != "" {
							t.Errorf("Stock (-) and renamed .vibe (+) canonical declarations differ:\n%s", record.Diff)
						} else {
							t.Error("a repaired Effect-value declaration witness must run without an admission skip")
						}
					}
				})
				CheckDeclarationIdentity(t, w, tsc, api, archive)
			})
		}
	}
}

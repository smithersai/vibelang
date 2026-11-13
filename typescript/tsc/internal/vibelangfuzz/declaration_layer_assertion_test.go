package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLayerAssertionDeclarationsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "Declarations are exactly what idiomatic Effect TypeScript would declare.")
	chapterSays(t, "000-intro.md", "TypeScript's meaning outside Effect code.")
	chapterSays(t, "001-functions.md", "Declarations are exactly what idiomatic Effect TypeScript would declare.")
}

// The keyed Alchemy minimum must pass the rename gate, not be admitted away.
func TestLayerAssertionDeclarationWitness(t *testing.T) {
	TestLayerAssertionDeclarationsQuoted(t)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzDeclarationIdentity/alchemy-layer-assertion-never"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 || lines[0] != "go test fuzz v1" || !strings.HasPrefix(lines[1], "string(") {
		t.Fatal("expected one keyed declaration-identity archive")
	}
	var archive string
	if err := json.Unmarshal([]byte(strings.TrimSuffix(strings.TrimPrefix(lines[1], "string("), ")")), &archive); err != nil {
		t.Fatal(err)
	}
	checkLayerAssertionIdentity(t, NewWorkspace(t), StockTypeScript(t), declarationIdentityAPI(t), archive)
}

func checkLayerAssertionIdentity(t *testing.T, w *Workspace, tsc, api, archive string) {
	t.Helper()
	report := filepath.Join(t.TempDir(), "declaration-diff.jsonl")
	t.Setenv("VIBELANG_FUZZ_DECLARATION_REPORT", report)
	t.Cleanup(func() {
		if !t.Skipped() {
			return
		}
		data, err := os.ReadFile(report)
		var record struct{ Diff string }
		if err == nil && json.Unmarshal(data, &record) == nil && record.Diff != "" {
			t.Errorf("Stock (-) and renamed .vibe (+) canonical declarations differ:\n%s", record.Diff)
		} else {
			t.Error("a layer assertion program must run without an admission skip")
		}
	})
	CheckDeclarationIdentity(t, w, tsc, api, archive)
}

package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

var existingPlatformBodyKeys = []string{"body-existing", "body-absent", "sibling-existing", "metadata-existing"}

func TestMigrationExistingPlatformBodyQuoted(t *testing.T) {
	r4Quoted(t, "../vips/0040-module-declarations.md", "**A body is a TypeScript file stored inside a \x60.vibe\x60 file.**")
	r4Quoted(t, "../../../.smithers/flows/migrate/rules.md", "Never rewrite an existing foreign file")
}
func checkExistingPlatformBody(t *testing.T, key string, mode uint8) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), max(HangLimit, workerHangLimit))
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_existing_platform_body.mjs"), key, strconv.Itoa(int(mode&15)))
	cmd.Dir = Root()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("platform body observation: %v\n%s", err, out)
	}
	type observation struct {
		Inline, CopyPreserved, SourceChanged, SiblingUnchanged, ManifestUnchanged, OnlySourceWritten bool
		Result                                                                                       struct{ Refused []string }
		Writes                                                                                       []string
	}
	var model struct{ Control, Actual observation }
	if err := json.Unmarshal(out, &model); err != nil {
		t.Fatalf("invalid platform observation: %v\n%s", err, out)
	}
	a := model.Actual
	if !a.SiblingUnchanged || !a.ManifestUnchanged {
		t.Fatalf("existing public helper or manifest changed:\n%s", out)
	}
	// A declared import.meta member stays in the module (chapter 5), so a metadata read takes the inline route too.
	if key == "body-existing" || key == "body-absent" || key == "metadata-existing" {
		c := model.Control
		if !c.Inline || !c.CopyPreserved || !c.OnlySourceWritten || len(c.Result.Refused) != 0 {
			t.Fatalf("the sibling-free control must support a preserving inline route:\n%s", out)
		}
		if !a.Inline {
			if key != "body-existing" || a.SourceChanged || len(a.Writes) != 0 || !strings.Contains(strings.Join(a.Result.Refused, "\n"), "already exists") {
				t.Fatalf("unexpected inline-route refusal:\n%s", out)
			}
			Gap(t, "FuzzMigrationExistingPlatformBody", "body:existing", "VIP-40: an unrelated existing sibling blocks a body-only repair that writes no sibling:\n%s", out)
		}
		if !a.CopyPreserved || !a.OnlySourceWritten || len(a.Result.Refused) != 0 {
			t.Fatalf("inline repair must preserve the source copy and write only its owner:\n%s", out)
		}
	} else if a.Inline || a.SourceChanged || len(a.Writes) != 0 || !strings.Contains(strings.Join(a.Result.Refused, "\n"), "already exists") {
		t.Fatalf("a route requiring physical sibling output must retain the collision refusal:\n%s", out)
	}
	if key == "body-existing" {
		ExpectPending(t, "FuzzMigrationExistingPlatformBody", "body:existing")
	}
	ExpectPending(t, "FuzzMigrationExistingPlatformBody", specCorpusKey(t))
}
func FuzzMigrationExistingPlatformBody(f *testing.F) {
	startShortBudget(f)
	for _, key := range existingPlatformBodyKeys {
		f.Add(key, uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationExistingPlatformBodyQuoted(t)
		if !slices.Contains(existingPlatformBodyKeys, key) {
			if key == "" {
				key = existingPlatformBodyKeys[0]
			} else {
				key = existingPlatformBodyKeys[int(key[0])%len(existingPlatformBodyKeys)]
			}
		}
		checkExistingPlatformBody(t, key, mode)
	})
}
func TestMigrationExistingPlatformBodyNeighborhood(t *testing.T) {
	if testing.Short() {
		t.Skip("the complete platform layout matrix runs separately")
	}
	for _, key := range existingPlatformBodyKeys {
		for mode := range uint8(16) {
			t.Run(key+"/"+strconv.Itoa(int(mode)), func(t *testing.T) { checkExistingPlatformBody(t, key, mode) })
		}
	}
}

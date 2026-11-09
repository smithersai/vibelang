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

func TestMigrationImportMetaPolicyQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite.")
	r4Quoted(t, "../vips/0034-compiler-and-tooling.md", "Existing tools work.")
}

var importMetaPolicyKeys = []string{"dirname", "filename", "env", "url", "dirname-pragma", "filename-pragma", "dirname-off", "main", "dirname-ignore-exit", "dirname-fix", "dirname-open"}

func checkImportMetaPolicy(t *testing.T, binary, key string, mode uint8) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_import_meta_policy.mjs"), key, strconv.Itoa(int(mode&15)), binary)
	cmd.Dir = Root()
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("import.meta policy process: %v; context=%v\n%s", err, ctx.Err(), output)
	}
	type run struct {
		Status int
		Codes  []int
		Text   string
	}
	var model struct {
		Original, Candidate  map[string]string
		Refused              []string
		StockCodes           []int
		Unchanged            bool
		Guard, Before, After *run
	}
	if err = json.Unmarshal(output, &model); err != nil {
		t.Fatalf("invalid import.meta model: %v\n%s", err, output)
	}
	if !model.Unchanged || len(model.StockCodes) != 0 {
		t.Fatalf("invalid independent source control: %s", output)
	}
	if key == "dirname" && (model.Guard == nil || !slices.Contains(model.Guard.Codes, 3877) || model.Guard.Status == 0) {
		t.Fatalf("native error-policy sensitivity control did not fail with EK3877: %s", output)
	}
	if model.Before == nil || model.Before.Status != 0 || len(model.Before.Codes) != 0 {
		t.Fatalf("native original rejected: %s", output)
	}
	if len(model.Refused) > 0 {
		for _, reason := range model.Refused {
			if !strings.Contains(reason, ".ts:") {
				t.Fatalf("unlocated refusal: %s", reason)
			}
		}
	} else {
		if model.After == nil {
			t.Fatal("missing candidate compiler observation")
		}
		if len(model.After.Codes) > 0 {
			for _, code := range model.After.Codes {
				if code != 3877 {
					t.Fatalf("unexpected candidate diagnostic: %s", output)
				}
			}
			Gap(t, "FuzzMigrationImportMetaPolicy", "policy:"+key+":EK3877", "VIP-34: the generated candidate introduces a forbidden Node import; the final migration must keep the original or explain its refusal\n%s", output)
		}
		if model.After.Status != 0 {
			t.Fatalf("candidate failed without an error diagnostic: %s", output)
		}
	}
	ExpectPending(t, "FuzzMigrationImportMetaPolicy", "policy:"+key+":EK3877")
	ExpectPending(t, "FuzzMigrationImportMetaPolicy", specCorpusKey(t))
}

func FuzzMigrationImportMetaPolicy(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	binary := cliBuild(f, w.Dir)
	// Every key once, so the ignore-exit and --fix observations run without fuzzing.
	for _, key := range importMetaPolicyKeys {
		f.Add(key, uint8(0))
	}
	f.Add("dirname-pragma", uint8(15))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationImportMetaPolicyQuoted(t)
		if !slices.Contains(importMetaPolicyKeys, key) {
			if key == "" {
				key = importMetaPolicyKeys[0]
			} else {
				key = importMetaPolicyKeys[int(key[0])%len(importMetaPolicyKeys)]
			}
		}
		checkImportMetaPolicy(t, binary, key, mode)
	})
}

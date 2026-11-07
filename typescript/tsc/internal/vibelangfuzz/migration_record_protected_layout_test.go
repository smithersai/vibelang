package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

var recordLayoutKeys = []string{"long", "comment-long", "fixture-long", "spec-long", "short", "formatted", "formatted-crlf", "assertion-loss"}

func TestMigrationRecordProtectedLayoutQuoted(t *testing.T) {
	r4Quoted(t, "../vips/0034-compiler-and-tooling.md", "Existing tools work.")
	text, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{"Protected tests and fixtures are excluded.", "After formatting, \u0060record\u0060 rejects protected test edits before rerunning verification"} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("the protected-file contract changed: %s", quote)
		}
	}
}
func checkRecordProtectedLayout(t *testing.T, key string, mode uint8) {
	t.Helper()
	// A recorded batch runs jj init, two commits, emit and the scope proof:
	// 6-11 s on a 4 vCPU box, past the 10 s per-stage default. Go kills a fuzz
	// worker after 60 s, so the budget stays at workerHangLimit.
	ctx, cancel := context.WithTimeout(t.Context(), max(HangLimit, workerHangLimit))
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_record_protected_layout.mjs"), key, strconv.Itoa(int(mode&15)))
	cmd.Dir = Root()
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("record layout fixture: %v; context=%v\n%s", err, ctx.Err(), output)
	}
	var model struct {
		Precheck, Postcheck, Recorded, ExactLayout, Changed, BaseUnchanged bool
		Reason, Formatter, Emitter                                         string
	}
	if err = json.Unmarshal(output, &model); err != nil {
		t.Fatalf("invalid record observation: %v\n%s", err, output)
	}
	if model.Formatter != "prettier@3.6.2" || model.Emitter != "deterministic-fixture" {
		t.Fatalf("invalid tooling fixture dependencies: %s", output)
	}
	if key == "assertion-loss" {
		if model.Precheck || model.Postcheck || model.Recorded || !model.ExactLayout || !model.BaseUnchanged || !strings.Contains(model.Reason, "forbidden test/fixture edits") {
			t.Fatalf("an assertion mutation must remain blocked before formatting: %s", output)
		}
	} else {
		if !model.Precheck {
			t.Fatalf("the literal-only original port was rejected: %s", output)
		}
		if model.Recorded {
			if !model.ExactLayout || !model.Postcheck {
				t.Fatalf("record admitted an unrelated protected-file edit: %s", output)
			}
		} else {
			if !model.Changed || model.Postcheck || !model.BaseUnchanged || !strings.Contains(model.Reason, "forbidden test/fixture edits") {
				t.Fatalf("record failed outside the known layout refusal: %s", output)
			}
			Gap(t, "FuzzMigrationRecordProtectedLayout", "layout:"+key, "VIP-34: record formats a protected TypeScript test outside its permitted module literal and refuses that extra edit\n%s", output)
		}
	}
	ExpectPending(t, "FuzzMigrationRecordProtectedLayout", "layout:"+key)
	ExpectPending(t, "FuzzMigrationRecordProtectedLayout", specCorpusKey(t))
}
func FuzzMigrationRecordProtectedLayout(f *testing.F) {
	startShortBudget(f)
	f.Add("long", uint8(0))
	f.Add("short", uint8(0))
	f.Add("assertion-loss", uint8(0))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationRecordProtectedLayoutQuoted(t)
		if !slices.Contains(recordLayoutKeys, key) {
			if key == "" {
				key = recordLayoutKeys[0]
			} else {
				key = recordLayoutKeys[int(key[0])%len(recordLayoutKeys)]
			}
		}
		checkRecordProtectedLayout(t, key, mode)
	})
}

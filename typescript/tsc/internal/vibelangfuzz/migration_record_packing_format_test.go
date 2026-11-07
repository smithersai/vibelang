package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
)

var recordPackingKeys = []string{"create", "existing", "unrouted"}

func TestMigrationRecordPackingFormatQuoted(t *testing.T) {
	r4Quoted(t, "../vips/0034-compiler-and-tooling.md", "Existing tools work.")
	text, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{
		"Upgrade-effect, setup and record run the target's own formatter on the files they wrote or the batch changed",
		"The target's format check then passes on them.",
	} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("the record formatting contract changed: %s", quote)
		}
	}
}
func checkRecordPackingFormat(t *testing.T, binary, key string, mode uint8) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), max(HangLimit, workerHangLimit))
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_record_packing_format.mjs"), key, strconv.Itoa(int(mode&15)))
	cmd.Dir = Root()
	cmd.Env = append(os.Environ(), "VIBELANG_BINARY="+binary, "VIBELANG_RUNTIME="+filepath.Join(Root(), "packages/runtime"))
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("record packing fixture: %v; context=%v\n%s", err, ctx.Err(), output)
	}
	var model struct {
		Recorded, Present, CanonicalOutput, VerificationOK, VerificationRefreshed bool
		Actual, Canonical, Formatter, Error                                       string
	}
	if err = json.Unmarshal(output, &model); err != nil {
		t.Fatalf("invalid record observation: %v\n%s", err, output)
	}
	if !model.Recorded || !model.VerificationOK || model.Error != "" || model.Formatter != "prettier@3.6.2" {
		t.Fatalf("the actual record and final verification must finish with the pinned formatter:\n%s", output)
	}
	if key == "create" && !model.VerificationRefreshed {
		t.Fatalf("first-time packing output requires fresh final verification:\n%s", output)
	}
	if key == "unrouted" {
		if model.Present {
			t.Fatalf("an unrouted fixture gained packing policy:\n%s", output)
		}
	} else {
		if !model.Present {
			t.Fatalf("a routed fixture has no packing receipt:\n%s", output)
		}
		var actual, canonical any
		if err := json.Unmarshal([]byte(model.Actual), &actual); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(model.Canonical), &canonical); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actual, canonical) {
			t.Fatalf("formatting changed policy values:\n%s", output)
		}
		if !model.CanonicalOutput {
			Gap(t, "FuzzMigrationRecordPackingFormat", "record:"+key, "VIP-34: record committed generated policy that the target's formatter would change:\n%s", output)
		}
	}
	ExpectPending(t, "FuzzMigrationRecordPackingFormat", "record:"+key)
	ExpectPending(t, "FuzzMigrationRecordPackingFormat", specCorpusKey(t))
}

// Official jobs build this source once before running record's seed matrix.
// An independent invocation can still build its own compiler.
func recordPackingCompiler(tb testing.TB) string {
	tb.Helper()
	if binary := os.Getenv("VIBELANG_BINARY"); binary != "" {
		info, err := os.Stat(binary)
		if err != nil || !info.Mode().IsRegular() {
			tb.Fatalf("the requested compiler is unavailable: %v", err)
		}
		tb.Log("record compiler setup: using the explicitly selected build")
		return binary
	}
	return cliBuild(tb, tb.TempDir())
}
func FuzzMigrationRecordPackingFormat(f *testing.F) {
	startShortBudget(f)
	binary := recordPackingCompiler(f)
	// The keyed corpus supplies the create witness. Short runs pair it with
	// one existing-receipt control; the complete matrix covers every layout.
	f.Add("existing", uint8(0))
	if !testing.Short() {
		f.Add("create", uint8(0))
		f.Add("unrouted", uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationRecordPackingFormatQuoted(t)
		if !slices.Contains(recordPackingKeys, key) {
			if key == "" {
				key = recordPackingKeys[0]
			} else {
				key = recordPackingKeys[int(key[0])%len(recordPackingKeys)]
			}
		}
		if testing.Short() {
			mode = 0
		}
		checkRecordPackingFormat(t, binary, key, mode)
	})
}
func TestMigrationRecordPackingFormatNeighborhood(t *testing.T) {
	if testing.Short() {
		t.Skip("the complete record/style matrix runs separately")
	}
	binary := recordPackingCompiler(t)
	for _, key := range recordPackingKeys {
		for mode := range uint8(16) {
			t.Run(key+"/"+strconv.Itoa(int(mode)), func(t *testing.T) { checkRecordPackingFormat(t, binary, key, mode) })
		}
	}
}

package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// legacyDeclared tracks unassigned implementation declarations, not accepted
// diagnostics. Each entry expires when its declaration disappears or its
// number gains a current assignment; TestCompilerRegistryIsSpecified checks it.
var legacyDeclared = map[int32]string{}

// TestRegistryDebtLedger checks the two views of one debt ledger. An emitted
// legacy code has a named, reduced corpus witness. A declaration without an
// emission witness explains that asymmetry on its own side.
// "declaration only" limits the allowance, not the reachability of the code:
// live compatibility paths may remain, but CheckDiagnostics still rejects their
// emissions unless their target has a separate, witnessed pending obligation.
func TestRegistryDebtLedger(t *testing.T) {
	entries, err := pendingEntries()
	if err != nil {
		t.Fatal(err)
	}
	emitted := map[int32]bool{}
	for _, entry := range entries {
		match := registryKey.FindStringSubmatch(entry.Key)
		if match == nil {
			continue
		}
		number, _ := strconv.Atoi(match[1])
		code := int32(number)
		emitted[code] = true
		if _, ok := legacyDeclared[code]; !ok {
			t.Errorf("%s %s: missing legacyDeclared entry", entry.Target, entry.Key)
		}
		name := "registry-EK" + match[1]
		if _, err := os.Stat(filepath.Join(repoTestdata(), "fuzz", entry.Target, name)); err != nil {
			t.Errorf("%s %s: missing reduced witness %s: %v", entry.Target, entry.Key, name, err)
		}
		if _, ok := Pending(entry.Target, "corpus:"+name); !ok {
			t.Errorf("%s %s: its witness has no XPASS corpus marker", entry.Target, entry.Key)
		}
	}
	for code, reason := range legacyDeclared {
		explained := strings.Contains(reason, "declaration only: ")
		if !emitted[code] && !explained {
			t.Errorf("%s: missing registry: pending key or declaration-only explanation", specCodeName(code))
		}
		if emitted[code] && explained {
			t.Errorf("%s: remove its stale declaration-only explanation", specCodeName(code))
		}
	}
}

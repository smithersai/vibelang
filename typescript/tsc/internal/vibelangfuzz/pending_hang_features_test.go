package vibelangfuzz

import (
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"
)

// An omitted feature records use even after its compiler hang is fixed.
// A same-target corpus witness makes the bounded hang oracle independent
// of that exclusion: TestPendingHangs bypasses it and rejects completion.
func hangFeatureWitnessProblem(entries []PendingEntry, feature PendingEntry) string {
	if feature.Owner == Superseded || !strings.HasPrefix(feature.Key, "feature:") || !strings.HasPrefix(feature.Reason, "hang") {
		return ""
	}
	if slices.ContainsFunc(entries, func(witness PendingEntry) bool {
		if witness.Target != feature.Target || witness.Owner == Superseded || !isHang(witness) {
			return false
		}
		return slices.ContainsFunc(strings.Fields(witness.Reason), func(word string) bool {
			return strings.Trim(word, "`.,;()[]") == feature.Key
		})
	}) {
		return ""
	}
	return "a hang exclusion needs a bounded hang witness: add a same-target corpus line starting with hang and naming " + feature.Key + ", so TestPendingHangs reports XPASS when the reproduction completes"
}

func TestPendingHangFeatureWitnesses(t *testing.T) {
	feature := PendingEntry{Target: "FuzzTools", Key: "feature:layer-declaration", Owner: "compiler", Reason: "hang: the parser loops"}
	witness := PendingEntry{Target: feature.Target, Key: "corpus:layer-hang", Owner: "compiler", Reason: "hang: feature:layer-declaration parser loop"}
	for _, tc := range []struct {
		name        string
		change      func(*PendingEntry)
		wantProblem bool
	}{
		{"linked", func(*PendingEntry) {}, false},
		{"other target", func(e *PendingEntry) { e.Target = "FuzzOther" }, true},
		{"other feature", func(e *PendingEntry) { e.Reason = "hang: feature:layer-declaration-extra" }, true},
		{"not a hang", func(e *PendingEntry) { e.Reason = "Chapter 28: feature:layer-declaration" }, true},
		{"not a corpus", func(e *PendingEntry) { e.Key = "feature:another-hang" }, true},
		{"superseded witness", func(e *PendingEntry) { e.Owner = Superseded }, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := witness
			tc.change(&input)
			problem := hangFeatureWitnessProblem([]PendingEntry{feature, input}, feature)
			if (problem != "") != tc.wantProblem {
				t.Fatalf("problem %q, want problem %v", problem, tc.wantProblem)
			}
		})
	}
	if hangFeatureWitnessProblem(nil, feature) == "" {
		t.Fatal("an unprobed hang exclusion escaped validation")
	}
	feature.Owner = Superseded
	if problem := hangFeatureWitnessProblem(nil, feature); problem != "" {
		t.Fatal(problem)
	}
	feature.Owner = "compiler"
	feature.Reason = "Chapter 28: not implemented"
	if problem := hangFeatureWitnessProblem(nil, feature); problem != "" {
		t.Fatal(problem)
	}
}

// Run the real ledger validator in a child: testing only its predicate would
// still pass if the validator stopped calling it.
func TestPendingHangFeatureGuardRegression(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestPendingHangLedgerProbe$")
	cmd.Env = append(os.Environ(), "VIBELANG_HANG_LEDGER_PROBE=1", "VIBELANG_FUZZ_REQUIRE=1")
	output, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(output), "a hang exclusion needs a bounded hang witness") {
		t.Fatalf("the ledger accepted an unprobed hang exclusion: exit %v\n%s", err, output)
	}
}

func TestPendingHangLedgerProbe(t *testing.T) {
	if os.Getenv("VIBELANG_HANG_LEDGER_PROBE") != "1" {
		t.Skip("subprocess control")
	}
	pendingEntries = func() ([]PendingEntry, error) {
		return []PendingEntry{{Target: "FuzzEditor", Key: "feature:layer-declaration", Owner: "compiler", Reason: "hang: omitted parser input"}}, nil
	}
	TestPendingLines(t)
}

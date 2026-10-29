package vibelangfuzz

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// The specification may be ahead of the compiler. A target never weakens an
// oracle to match today's behavior; it reports the disagreement as a Gap, and
// the files in testdata/pending/ name the gaps the compiler is known to have, the way
// a pending file marks an acceptance case. Each file in testdata/pending/
// holds the lines of one area, one gap per line:
//
//	# target          key                   owner  what is missing
//	FuzzSpecPrograms  feature:await.race    F5     D123: await.race is not lowered
//	FuzzCompile       corpus:3f2a9c1e0b7d   S3     D267: emitted JS imports node:util
//
// The key is "feature:<name>" for a generator feature, "ek:<EK code>" for a
// rule, or "corpus:<file>" for one input in testdata/fuzz/<target>/. The
// owner is the lane or person who owns the missing part. A pending gap skips;
// a pending corpus input that passes fails as XPASS, so its owner deletes the
// line in the commit that fixes it. A generator leaves pending features out
// unless VIBELANG_FUZZ_PENDING=1, so a campaign finds new bugs instead of the
// known ones.
//
// A VIP can replace the rule an oracle checks. The owner "superseded" turns
// such an oracle off for good, with the VIP that replaced its rule:
//
//	FuzzConfig  ek:EK4834  superseded  VIP-6: effectGlobals turns the globals off
//
// A superseded key skips like a pending one but never fails as XPASS, since
// the old rule no longer says what should happen. Only a superseded key may
// end in "*", which matches every key with that prefix. Rewrite or delete the
// oracle when its new rule is in the specification, and delete the line then.

// A PendingEntry is one line of a file in testdata/pending/.
type PendingEntry struct {
	Target, Key, Owner, Reason string
}

var pendingEntries = sync.OnceValues(func() ([]PendingEntry, error) {
	names, err := filepath.Glob(filepath.Join(repoTestdata(), "pending", "*.txt"))
	if err != nil {
		return nil, err
	}
	var entries []PendingEntry
	for _, name := range names {
		file, err := os.Open(name)
		if err != nil {
			return nil, err
		}
		scanner := bufio.NewScanner(file)
		for line := 1; scanner.Scan(); line++ {
			text := strings.TrimSpace(scanner.Text())
			if text == "" || strings.HasPrefix(text, "#") {
				continue
			}
			fields := strings.Fields(text)
			if len(fields) < 4 {
				file.Close()
				return nil, fmt.Errorf("%s:%d: want <target> <key> <owner> <what is missing>", name, line)
			}
			entries = append(entries, PendingEntry{Target: fields[0], Key: fields[1], Owner: fields[2], Reason: strings.Join(fields[3:], " ")})
		}
		file.Close()
		if err := scanner.Err(); err != nil {
			return nil, err
		}
	}
	return entries, nil
})

func repoTestdata() string {
	return filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata")
}

// Superseded is the owner of a line whose oracle a VIP replaced.
const Superseded = "superseded"

// Pending returns the pending entry of a target's key.
func Pending(target, key string) (PendingEntry, bool) {
	entries, err := pendingEntries()
	if err != nil {
		panic(err)
	}
	return findPending(entries, target, key)
}

// SkipRetired skips a target, or a test of its oracles, that a superseded
// line keyed "*" retires: the VIPs replaced everything it checks.
func SkipRetired(tb testing.TB, target string) {
	tb.Helper()
	if entry, ok := Pending(target, "*"); ok && entry.Owner == Superseded {
		tb.Skipf("%s is retired, superseded by %s", target, entry.Reason)
	}
}

// findPending returns the entry of a target's key: its own line, or else a
// superseded line whose key ends in "*" and prefixes it.
func findPending(entries []PendingEntry, target, key string) (PendingEntry, bool) {
	for _, entry := range entries {
		if entry.Target == target && entry.Key == key {
			return entry, true
		}
	}
	for _, entry := range entries {
		if prefix, ok := strings.CutSuffix(entry.Key, "*"); ok && entry.Owner == Superseded && entry.Target == target && strings.HasPrefix(key, prefix) {
			return entry, true
		}
	}
	return PendingEntry{}, false
}

// PendingFeatures returns the generator features of a target that are
// pending, which a generator leaves out unless VIBELANG_FUZZ_PENDING=1.
func PendingFeatures(target string) map[string]PendingEntry {
	features := map[string]PendingEntry{}
	if os.Getenv("VIBELANG_FUZZ_PENDING") == "1" {
		return features
	}
	entries, err := pendingEntries()
	if err != nil {
		panic(err)
	}
	for _, entry := range entries {
		if name, ok := strings.CutPrefix(entry.Key, "feature:"); ok && entry.Target == target {
			features[name] = entry
		}
	}
	return features
}

// Gap reports that the compiler disagrees with the specification. A pending
// key skips with its owner, a superseded key with its VIP; any other key
// fails.
func Gap(t testing.TB, target, key, format string, args ...any) {
	t.Helper()
	entries, err := pendingEntries()
	if err != nil {
		panic(err)
	}
	gapIn(t, entries, target, key, fmt.Sprintf(format, args...))
}

func gapIn(t testing.TB, entries []PendingEntry, target, key, failure string) {
	t.Helper()
	if entry, ok := findPending(entries, target, key); ok {
		if entry.Owner == Superseded {
			t.Skipf("superseded by %s\n%s", entry.Reason, failure)
		}
		t.Skipf("pending (%s): %s\n%s", entry.Owner, entry.Reason, failure)
	}
	t.Fatalf("%s %s: %s", target, key, failure)
}

// ExpectPending fails a pending corpus input that now passes. Call it after
// every oracle of the input held. A superseded input never fails here: the
// rule it was pending on is gone.
func ExpectPending(t testing.TB, target, key string) {
	t.Helper()
	entries, err := pendingEntries()
	if err != nil {
		panic(err)
	}
	expectPending(t, entries, target, key)
}

func expectPending(t testing.TB, entries []PendingEntry, target, key string) {
	t.Helper()
	if entry, ok := findPending(entries, target, key); ok && entry.Owner != Superseded {
		t.Fatalf("XPASS %s %s: it now meets the specification; delete its line in testdata/pending/ (%s: %s)", target, key, entry.Owner, entry.Reason)
	}
}

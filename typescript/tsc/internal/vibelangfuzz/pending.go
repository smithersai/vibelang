package vibelangfuzz

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"slices"
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
//
// A line must stay reachable. The package records each line an oracle
// raises or deliberately omits, and a gate run (VIBELANG_FUZZ_REQUIRE=1) that
// runs a target whole fails when one of the target's lines was never used:
// no seed raises that key any more, or the key is misspelt, and the line
// would excuse the failure for good if it came back (UnusedPending).

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

// pendingUsed holds the lines this process used, as "<target> <key>".
var pendingUsed sync.Map

// usePending records that an oracle raised a gap or deliberately omitted
// an input for the feature the line names.
func usePending(entry PendingEntry) { pendingUsed.Store(entry.Target+" "+entry.Key, true) }

// pendingUnjudged holds the targets whose complete matrix this process
// skipped (SkipShortMatrix): their lines cannot be judged unused.
var pendingUnjudged sync.Map

// SkipShortMatrix skips a target's complete matrix test in a -short run
// unless env or VIBELANG_FUZZ_MATRIX=1 is set, and leaves the target's
// pending lines unjudged in this process: a key only the matrix raises would
// otherwise read as stale. The gate (pending.sh) sets VIBELANG_FUZZ_MATRIX
// and runs a matrix registered with PendingCompanion whole.
func SkipShortMatrix(t testing.TB, target, env, reason string) {
	t.Helper()
	if !testing.Short() || os.Getenv(env) != "" || os.Getenv("VIBELANG_FUZZ_MATRIX") == "1" {
		return
	}
	pendingUnjudged.Store(target, true)
	t.Skip(reason)
}

// judgedTargets narrows ran to the targets whose complete matrix, if any,
// was not skipped in this process.
func judgedTargets(ran func(test string) bool) func(test string) bool {
	return func(test string) bool {
		if _, skipped := pendingUnjudged.Load(test); skipped {
			return false
		}
		return ran(test)
	}
}

// pendingCompanions holds, for a target, the tests besides its own seeds
// that raise keys under its name.
var pendingCompanions = map[string][]string{}

// PendingCompanion registers a test that raises keys under a fuzz target's
// name, such as a table test of the target's oracle. A target's lines are
// judged unused only by a run of the target and all its companions. Call it
// from the test file's init, and keep the test in the -short run: a line
// only a longer run reaches is never judged.
func PendingCompanion(target string, tests ...string) bool {
	pendingCompanions[target] = append(pendingCompanions[target], tests...)
	return true
}

// UnusedPending returns the lines no oracle used although everything that
// raises their target's keys ran: ran reports whether a test ran whole (a
// target with all its seeds), and used whether a gap was raised or deliberately omitted. Such a
// line is stale or misspelt. A corpus line is left to ExpectPending, which
// fails its input as XPASS, and a superseded line never fails.
func UnusedPending(entries []PendingEntry, companions map[string][]string, ran func(test string) bool, used func(entry PendingEntry) bool) []PendingEntry {
	var unused []PendingEntry
	for _, entry := range entries {
		if entry.Owner == Superseded || strings.HasPrefix(entry.Key, "corpus:") || used(entry) {
			continue
		}
		if !ran(entry.Target) || slices.ContainsFunc(companions[entry.Target], func(test string) bool { return !ran(test) }) {
			continue
		}
		unused = append(unused, entry)
	}
	return unused
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
	if entry, ok := findPending(entries, target, key); ok {
		usePending(entry)
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

// ExpectPending fails a pending key that now passes: a corpus input, after
// every oracle of the input held, or an oracle's own key, when the key names
// one probe and the probe held. A superseded key never fails here: the rule
// it was pending on is gone.
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

// pendingSeedInputs picks one reproducible input per pending oracle key.
// Merely selecting a seed does not record use: its oracle must still fail,
// or report XPASS, when the seed runs.
func pendingSeedInputs(target string, count int, keyAt func(int) (string, string)) []string {
	seen := map[string]bool{}
	var inputs []string
	for i := 0; i < count; i++ {
		input, key := keyAt(i)
		if seen[key] {
			continue
		}
		if entry, pending := Pending(target, key); pending && entry.Owner != Superseded {
			inputs = append(inputs, input)
			seen[key] = true
		}
	}
	return inputs
}

package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

// productOwners own a gap in the product; any other owner is the area whose
// test does not reach a part of the specification yet.
var productOwners = map[string]bool{"compiler": true, "projector": true}

// An accepted VIP in docs/design/vips/ is a decision too: where it
// disagrees with the specification, the VIP wins.
var specCitation = regexp.MustCompile(`\bD\d{1,3}\b|Chapter \d+|\bCh \d+|Appendix|LSP|\bVIP-\d+\b`)

// TestPendingLines keeps testdata/pending/ honest: each line names a target
// the package defines, a reproduction that exists, and the part of the
// specification the compiler does not meet yet, so a gap is never an
// unexplained skip.
func TestPendingLines(t *testing.T) {
	entries, err := pendingEntries()
	if err != nil {
		t.Fatal(err)
	}
	targets := fuzzTargets(t)
	tests := testFunctions(t)
	for target, companions := range pendingCompanions {
		for _, test := range append([]string{target}, companions...) {
			if !tests[test] {
				t.Errorf("PendingCompanion(%s): no test %s in this package", target, test)
			}
		}
	}
	seen := map[string]bool{}
	debt, superseded := 0, 0
	for _, e := range entries {
		id := e.Target + " " + e.Key
		if seen[id] {
			t.Errorf("%s is listed twice", id)
		}
		seen[id] = true
		if !targets[e.Target] {
			t.Errorf("%s: no target %s in this package", id, e.Target)
		}
		if name, ok := strings.CutPrefix(e.Key, "corpus:"); ok {
			if _, err := os.Stat(filepath.Join(repoTestdata(), "fuzz", e.Target, name)); err != nil {
				t.Errorf("%s: its reproduction is missing: %v", id, err)
			}
		}
		if e.Key == declarationIdentityKey {
			t.Errorf("%s: the key names no difference, so every declaration difference of every input would skip; name the export that differs, as %s:type:<export>", id, declarationIdentityKey)
		}
		if problem := hangFeatureWitnessProblem(entries, e); problem != "" {
			t.Errorf("%s: %s", id, problem)
		}
		if problem := deadKey(e); problem != "" {
			t.Errorf("%s: %s, so the line skips nothing and never fails as XPASS", id, problem)
		}
		if e.Owner == Superseded {
			if problem := supersededProblem(e); problem != "" {
				t.Errorf("%s: %s", id, problem)
			}
			superseded++
			continue
		}
		if strings.HasSuffix(e.Key, "*") {
			t.Errorf("%s: only a superseded key may end in *; a pending key names one gap", id)
		}
		if !productOwners[e.Owner] {
			debt++
			continue
		}
		// A crash or a hang is a bug whatever the specification says; a
		// reproduction may cite the gap it reproduces.
		if specCitation.MatchString(e.Reason) || strings.HasPrefix(e.Reason, "hang") || strings.HasPrefix(e.Key, "crash:") || strings.Contains(e.Reason, "panics") || citesPendingKey(e) {
			continue
		}
		t.Errorf("%s: name the chapter or decision the compiler does not meet: %s", id, e.Reason)
	}
	t.Logf("%d pending lines, %d of them parts of the specification no test reaches yet, %d superseded by a VIP", len(entries), debt, superseded)
}

// vipReason is a superseded line's reason: the VIP that replaced the rule.
var vipReason = regexp.MustCompile(`^VIP-(\d+): \S`)

// supersededProblem names what is wrong with a superseded line: its reason
// must start with an accepted VIP in docs/design/vips/.
func supersededProblem(e PendingEntry) string {
	m := vipReason.FindStringSubmatch(e.Reason)
	if m == nil {
		return "a superseded line's reason starts with the VIP that replaced the rule, as \"VIP-6: ...\""
	}
	n, _ := strconv.Atoi(m[1])
	vips := filepath.Join(Root(), "docs/design/vips")
	if files, _ := filepath.Glob(filepath.Join(vips, fmt.Sprintf("%04d-*.md", n))); len(files) == 0 {
		return fmt.Sprintf("VIP-%d is not in docs/design/vips", n)
	}
	readme, err := os.ReadFile(filepath.Join(vips, "README.md"))
	if err != nil {
		return err.Error()
	}
	accepted := regexp.MustCompile(fmt.Sprintf(`(?m)^\| \[%d\]\(.*\| accepted `, n))
	if !accepted.Match(readme) {
		return fmt.Sprintf("VIP-%d is not accepted in docs/design/vips/README.md", n)
	}
	return ""
}

// TestSuperseded checks the superseded owner: a "*" key matches only on a
// superseded line, a superseded gap skips, and a superseded input that meets
// every oracle never fails as XPASS.
func TestSuperseded(t *testing.T) {
	entries := []PendingEntry{
		{Target: "FuzzX", Key: "ek:EK48*", Owner: Superseded, Reason: "VIP-6: the globals changed"},
		{Target: "FuzzX", Key: "ek:EK44*", Owner: "compiler", Reason: "D1: not a wildcard"},
		{Target: "FuzzX", Key: "corpus:old", Owner: Superseded, Reason: "VIP-6: the globals changed"},
	}
	if _, ok := findPending(entries, "FuzzX", "ek:EK4834/running-succeed"); !ok {
		t.Error("a superseded ek:EK48* line does not match ek:EK4834/running-succeed")
	}
	if _, ok := findPending(entries, "FuzzX", "ek:EK4401"); ok {
		t.Error("a compiler line's * matched a key; only a superseded key is a prefix")
	}
	if _, ok := findPending(entries, "FuzzY", "ek:EK4834"); ok {
		t.Error("a superseded line matched another target")
	}
	var skipped *testing.T
	t.Run("gap", func(t *testing.T) {
		skipped = t
		gapIn(t, entries, "FuzzX", "ek:EK4834", "the old rule disagrees")
	})
	if !skipped.Skipped() {
		t.Error("a superseded gap did not skip")
	}
	t.Run("no-xpass", func(t *testing.T) {
		expectPending(t, entries, "FuzzX", "corpus:old")
	})
	for reason, want := range map[string]bool{
		"VIP-6: effectGlobals turns the globals off": true,
		"VIP-8: using was denied":                    false,
		"VIP-999: no such proposal":                  false,
		"the globals changed":                        false,
	} {
		if got := supersededProblem(PendingEntry{Reason: reason}) == ""; got != want {
			t.Errorf("supersededProblem(%q) accepts it: %v, want %v", reason, got, want)
		}
	}
}

var registryKey = regexp.MustCompile(`^registry:EK(38\d{2,}|\d{4})$`)

var ekKey = regexp.MustCompile(`^ek:EK(38\d{2,}|\d{4})(/.+)?$`)

// deadKey rejects codes absent from the current registry and missing injections.
func deadKey(e PendingEntry) string {
	if m := registryKey.FindStringSubmatch(e.Key); m != nil {
		code, _ := strconv.Atoi(m[1])
		if SpecHasCode(int32(code)) {
			return "the current specification now registers EK" + m[1]
		}
		return ""
	}
	m := ekKey.FindStringSubmatch(e.Key)
	if m == nil {
		return ""
	}
	if code, _ := strconv.Atoi(m[1]); !SpecHasCode(int32(code)) {
		return "the current specification never registers EK" + m[1]
	}
	if m[2] != "" && e.Target == rulesTarget {
		for _, inj := range ruleInjections {
			if inj.Key() == e.Key {
				return ""
			}
		}
		return "no injection has this key"
	}
	return ""
}

// citesPendingKey reports whether a reproduction's reason names another
// pending key of its target, whose line cites the specification.
func citesPendingKey(e PendingEntry) bool {
	if !strings.HasPrefix(e.Key, "corpus:") {
		return false
	}
	entries, err := pendingEntries()
	if err != nil {
		return false
	}
	for _, word := range strings.Fields(e.Reason) {
		// findPending, not Pending: checking a citation uses no line.
		if _, ok := findPending(entries, e.Target, strings.Trim(word, ",.;()")); ok && word != e.Key {
			return true
		}
	}
	return false
}

// fatalRecorder records the failure of a check that ends its test.
type fatalRecorder struct {
	testing.TB
	fatal string
}

func (r *fatalRecorder) Helper()                           {}
func (r *fatalRecorder) Fatalf(format string, args ...any) { r.fatal = fmt.Sprintf(format, args...) }

// TestOracleKeyXPASS checks that a pending line under an oracle's own key
// fails as XPASS when the oracle holds, as a corpus line does: a line left
// behind by a fix would excuse the same failure if it came back.
func TestOracleKeyXPASS(t *testing.T) {
	entries := []PendingEntry{{Target: "FuzzX", Key: "contract:probe", Owner: "compiler", Reason: "D1: the contract is missing"}}
	passed := &fatalRecorder{}
	expectPending(passed, entries, "FuzzX", "contract:probe")
	if !strings.HasPrefix(passed.fatal, "XPASS FuzzX contract:probe") {
		t.Errorf("a pending oracle key that passes did not fail as XPASS: %q", passed.fatal)
	}
	other := &fatalRecorder{}
	expectPending(other, entries, "FuzzX", "contract:other")
	if other.fatal != "" {
		t.Errorf("a key with no line failed: %q", other.fatal)
	}
}

// TestUnusedPending checks the whole-run rule: a line of a target whose
// every seed ran, which no oracle raised or deliberately omitted, is reported; corpus
// and superseded lines and targets that did not run whole are not.
func TestUnusedPending(t *testing.T) {
	entries := []PendingEntry{
		{Target: "FuzzX", Key: "contract:fixed", Owner: "compiler", Reason: "D1: fixed since"},
		{Target: "FuzzX", Key: "contract:open", Owner: "compiler", Reason: "D1: still open"},
		{Target: "FuzzX", Key: "corpus:witness", Owner: "compiler", Reason: "contract:open"},
		{Target: "FuzzX", Key: "ek:EK48*", Owner: Superseded, Reason: "VIP-6: the globals changed"},
		{Target: "FuzzY", Key: "contract:fixed", Owner: "compiler", Reason: "D1: not run"},
	}
	used := func(entry PendingEntry) bool { return entry.Key == "contract:open" }
	unused := UnusedPending(entries, nil, func(test string) bool { return test == "FuzzX" }, used)
	if len(unused) != 1 || unused[0] != entries[0] {
		t.Errorf("unused lines: %v, want only %v", unused, entries[0])
	}
	// A table test that raises the target's keys must have run too.
	companions := map[string][]string{"FuzzX": {"TestXTable"}}
	if unused := UnusedPending(entries, companions, func(test string) bool { return test == "FuzzX" }, used); len(unused) != 0 {
		t.Errorf("lines were judged without the target's companion test: %v", unused)
	}
	if unused := UnusedPending(entries, companions, func(test string) bool { return test == "FuzzX" || test == "TestXTable" }, used); len(unused) != 1 {
		t.Errorf("unused lines with the companion run: %v, want only %v", unused, entries[0])
	}
	for _, tc := range []struct {
		name       string
		env, flags map[string]string
		judged     bool
		ran        map[string]bool
	}{
		{"no gate", nil, nil, false, nil},
		{"whole package", map[string]string{"VIBELANG_FUZZ_REQUIRE": "1"}, nil, true, map[string]bool{"FuzzX": true, "FuzzY": true}},
		{"named targets", map[string]string{"VIBELANG_FUZZ_REQUIRE": "1"}, map[string]string{"test.run": "^(FuzzX|TestZ)$"}, true, map[string]bool{"FuzzX": true, "FuzzY": false}},
		{"one seed", map[string]string{"VIBELANG_FUZZ_REQUIRE": "1"}, map[string]string{"test.run": "^FuzzX$/^witness$"}, false, nil},
		{"fuzzing", map[string]string{"VIBELANG_FUZZ_REQUIRE": "1"}, map[string]string{"test.fuzz": "FuzzX"}, false, nil},
		{"skipping", map[string]string{"VIBELANG_FUZZ_REQUIRE": "1"}, map[string]string{"test.skip": "FuzzX"}, false, nil},
		{"pending features generated", map[string]string{"VIBELANG_FUZZ_REQUIRE": "1", "VIBELANG_FUZZ_PENDING": "1"}, nil, false, nil},
		{"hang probe", map[string]string{"VIBELANG_FUZZ_REQUIRE": "1", "VIBELANG_FUZZ_HANG_PROBE": "1"}, nil, false, nil},
	} {
		ran := wholeTargets(func(name string) string { return tc.env[name] }, func(name string) string { return tc.flags[name] })
		if (ran != nil) != tc.judged {
			t.Errorf("%s: judged %v, want %v", tc.name, ran != nil, tc.judged)
			continue
		}
		for target, want := range tc.ran {
			if ran(target) != want {
				t.Errorf("%s: %s ran whole: %v, want %v", tc.name, target, !want, want)
			}
		}
	}
}

// TestDeclarationIdentityKeys checks that a declaration difference is keyed
// by the export that differs, so the line of one known difference does not
// excuse another: a dropped readonly on Shape is not the lifted function f.
func TestDeclarationIdentityKeys(t *testing.T) {
	const none = "Name differences:\n  (none)\nType differences:\n  (none)\nDoc-comment differences:\n  (none)\nEnvironment diagnostics:\n  (none)"
	readonly := strings.Replace(none, "Type differences:\n  (none)", "Type differences:\n  {\"entrypoint\":\".\",\"export\":\"Shape\",\"aspect\":\"type\",\"mutuallyAssignable\":false,\"diagnostic\":\"Type '{ id: number; }' is not assignable to type '{ readonly id: number; }'.\"}", 1)
	for _, tc := range []struct {
		name, diff string
		want       []string
	}{
		{"readonly", readonly, []string{"feature:declaration-identity:type:Shape"}},
		{"name and doc", strings.NewReplacer(
			"Name differences:\n  (none)", "Name differences:\n  {\"entrypoint\":\".\",\"export\":\"gone\",\"side\":\"before\"}\n  {\"entrypoint\":\".\",\"export\":\"gone\",\"meaning\":\"runtime value\",\"side\":\"before\"}",
			"Doc-comment differences:\n  (none)", "Doc-comment differences:\n  {\"entrypoint\":\".\",\"export\":\"Box.size\",\"before\":\"The size.\",\"after\":\"\"}",
		).Replace(none), []string{"feature:declaration-identity:name:gone", "feature:declaration-identity:doc:Box.size"}},
		{"unattributed", strings.Replace(none, "Environment diagnostics:\n  (none)", "Environment diagnostics:\n  {\"diagnostic\":\"Cannot find module 'x'.\"}", 1), []string{declarationIdentityKey}},
	} {
		got := declarationIdentityKeys(tc.diff)
		if !slices.Equal(got, tc.want) {
			t.Errorf("%s: keys %v, want %v", tc.name, got, tc.want)
		}
		for _, key := range got {
			if entry, ok := Pending("FuzzDeclarationIdentity", key); ok && tc.name != "unattributed" {
				t.Errorf("%s: the synthetic difference %s is pending (%s), so it would skip", tc.name, key, entry.Reason)
			}
		}
	}
	if _, ok := Pending("FuzzDeclarationIdentity", declarationIdentityKey); ok {
		t.Errorf("%s is pending: every unattributed difference would skip", declarationIdentityKey)
	}
}

// withinPanic is the panic of Within when a stage hangs.
var withinPanic = regexp.MustCompile(`panic: hang: .+ took longer than`)

// Only copy the harness's fixed phase metadata, never a reproduction's source
// or other child output. A stage watchdog is stronger evidence than an outer
// deadline that happened to expire while its panic was being collected.
var probeProgressLine = regexp.MustCompile(`(?m)^[\t ]*compile_fuzz_test\.go:[0-9]+: probe-stage (start|done): (compile|recompile|reverse file order|emit first|outputs)[\t ]*$`)

func hangProbeSummary(timedOut bool, output string) string {
	cause := "exited"
	if withinPanic.MatchString(output) {
		cause = "stage-watchdog"
	} else if timedOut {
		cause = "outer-deadline"
	}
	var progress []string
	for _, match := range probeProgressLine.FindAllStringSubmatch(output, -1) {
		progress = append(progress, match[1]+":"+match[2])
	}
	if len(progress) > 8 {
		progress = progress[len(progress)-8:]
	}
	return fmt.Sprintf("cause=%s progress=%q", cause, strings.Join(progress, " -> "))
}

func isHang(e PendingEntry) bool {
	return strings.HasPrefix(e.Key, "corpus:") && strings.HasPrefix(e.Reason, "hang")
}

// fuzzTargets returns the names of the package's Fuzz functions.
func fuzzTargets(t *testing.T) map[string]bool {
	return declaredTests(t, regexp.MustCompile(`(?m)^func (Fuzz\w+)\(f \*testing\.F\)`))
}

// testFunctions returns the names of the package's Test and Fuzz functions.
func testFunctions(t *testing.T) map[string]bool {
	return declaredTests(t, regexp.MustCompile(`(?m)^func ((?:Test|Fuzz)\w+)\(\w+ \*testing\.[TF]\)`))
}

func declaredTests(t *testing.T, declaration *regexp.Regexp) map[string]bool {
	t.Helper()
	files, err := filepath.Glob("*_test.go")
	if err != nil {
		t.Fatal(err)
	}
	targets := map[string]bool{}
	for _, name := range files {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range declaration.FindAllStringSubmatch(string(data), -1) {
			targets[m[1]] = true
		}
	}
	return targets
}

// TestPendingHangs runs each pending hang's reproduction in a child test
// process with a deadline, in the smoke run too. A target skips a pending hang, since a hang ends
// the process it runs in; VIBELANG_FUZZ_HANG_PROBE=1 makes the child run it.
// A reproduction that now finishes fails here as XPASS, so its owner
// deletes its line, as any other pending reproduction's.
func TestPendingHangs(t *testing.T) {
	if os.Getenv("VIBELANG_FUZZ_HANG_PROBE") == "1" {
		t.Skip("a probe runs only its reproduction")
	}
	entries, err := pendingEntries()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !isHang(e) {
			continue
		}
		name := strings.TrimPrefix(e.Key, "corpus:")
		t.Run(e.Target+"/"+name, func(t *testing.T) {
			t.Parallel()
			// Bound each child independently of its per-stage watchdog. An
			// outer deadline alone does not identify a slow compiler phase;
			// the summary records which limit ended this probe.
			limit := 15 * time.Second
			ctx, cancel := context.WithTimeout(context.Background(), 2*limit)
			defer cancel()
			child := exec.CommandContext(ctx, binary, "-test.run", "^"+e.Target+"$/^"+regexp.QuoteMeta(name)+"$", "-test.v")
			child.Env = append(os.Environ(), "VIBELANG_FUZZ_HANG_PROBE=1", "VIBELANG_FUZZ_HANG="+limit.String())
			started := time.Now()
			out, probeErr := child.CombinedOutput()
			text := string(out)
			exit := -1
			if child.ProcessState != nil {
				exit = child.ProcessState.ExitCode()
			}
			t.Logf("hang probe target=%s key=%s elapsed=%v exit=%d error=%v %s",
				e.Target, e.Key, time.Since(started).Round(time.Millisecond), exit, probeErr,
				hangProbeSummary(ctx.Err() != nil, text))
			switch {
			case ctx.Err() != nil || withinPanic.MatchString(text):
				t.Logf("still hangs: %s", e.Reason)
			case !strings.Contains(text, "=== RUN   "+e.Target+"/"+name):
				t.Errorf("the probe did not run %s/%s:\n%s", e.Target, name, lastBytes(text, 2000))
			case strings.Contains(text, "--- SKIP: "+e.Target+"/"+name) && !strings.Contains(text, "pending ("):
				t.Errorf("the probe skipped %s/%s, so it cannot tell whether the hang is fixed:\n%s", e.Target, name, lastBytes(text, 2000))
			default:
				t.Errorf("XPASS %s %s: the reproduction completes without a stage watchdog (per-stage limit %v); delete its hang line in testdata/pending/ (%s: %s)\n%s", e.Target, e.Key, limit, e.Owner, e.Reason, lastBytes(text, 2000))
			}
		})
	}
}

func lastBytes(text string, n int) string {
	if len(text) > n {
		return "..." + text[len(text)-n:]
	}
	return text
}

// Looking a line up, including when a generator obtains its exclusion map,
// proves neither that its gap still exists nor that any input was omitted.
func TestPendingLookupDoesNotProveGap(t *testing.T) {
	old := pendingEntries
	defer func() { pendingEntries = old }()
	pendingEntries = func() ([]PendingEntry, error) {
		return []PendingEntry{
			{Target: "FuzzLookupProbe", Key: "contract:fixed", Owner: "compiler"},
			{Target: "FuzzLookupProbe", Key: "feature:unused", Owner: "compiler"},
		}, nil
	}
	Pending("FuzzLookupProbe", "contract:fixed")
	PendingFeatures("FuzzLookupProbe")
	for _, key := range []string{"contract:fixed", "feature:unused"} {
		if _, ok := pendingUsed.Load("FuzzLookupProbe " + key); ok {
			t.Errorf("lookup of %s falsely proved a gap", key)
		}
	}
}

// Run the real pending script with a compiler stub that records its test
// selections. New oracle key prefixes must not need a shell allowlist.
func TestPendingScriptSelectsArbitraryKeys(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "internal/vibelangfuzz")
	if err := os.MkdirAll(filepath.Join(dir, "testdata/pending"), 0755); err != nil {
		t.Fatal(err)
	}
	script, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/pending.sh"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pending.sh"), script, 0600); err != nil {
		t.Fatal(err)
	}
	var lines strings.Builder
	targets := []string{"FuzzContract", "FuzzResolve", "FuzzSpread", "FuzzExit", "FuzzFuture9"}
	for i, prefix := range []string{"contract", "resolve", "spread", "exit", "future-key"} {
		fmt.Fprintf(&lines, "%s %s:fixed compiler D1: test gap\n", targets[i], prefix)
	}
	if err := os.WriteFile(filepath.Join(dir, "testdata/pending/probes.txt"), []byte(lines.String()), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "probe_test.go"), []byte("var _ = PendingCompanion(\"FuzzContract\", \"TestContractTable\")\n"), 0600); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "bin")
	if err := os.MkdirAll(bin, 0755); err != nil {
		t.Fatal(err)
	}
	probe := filepath.Join(root, "probe")
	log := filepath.Join(root, "selections")
	if err := os.WriteFile(probe, []byte("#!/bin/sh\nlast=; for arg do if [ \"$last\" = -test.run ]; then echo \"$arg\" >> \"$MOCK_LOG\"; fi; case \"$arg\" in -test.run=*) echo \"${arg#-test.run=}\" >> \"$MOCK_LOG\";; esac; last=$arg; done\n"), 0755); err != nil {
		t.Fatal(err)
	}
	fakeGo := "#!/bin/sh\nwhile [ \"$#\" -gt 0 ]; do\n if [ \"$1\" = \"-o\" ]; then\n  shift\n  cp \"$MOCK_PROBE\" \"$1\"\n  chmod +x \"$1\"\n  exit 0\n fi\n shift\ndone\nexit 2\n"
	if err := os.WriteFile(filepath.Join(bin, "go"), []byte(fakeGo), 0755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("sh", filepath.Join(dir, "pending.sh"))
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "PATH="+bin+string(os.PathListSeparator)+os.Getenv("PATH"), "MOCK_PROBE="+probe, "MOCK_LOG="+log)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("pending script: %v\n%s", err, out)
	}
	data, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range append(targets, "TestContractTable") {
		selected := false
		for _, pattern := range strings.Split(strings.TrimSpace(string(data)), "\n") {
			if strings.Contains(pattern, "/") {
				continue
			}
			re, err := regexp.Compile(pattern)
			if err != nil {
				t.Fatal(err)
			}
			selected = selected || re.MatchString(target)
		}
		if !selected {
			t.Errorf("%s has no whole-target selection: %s", target, data)
		}
	}
}

type omissionRecorder struct {
	testing.TB
	skip string
}

func (r *omissionRecorder) Helper()                          {}
func (r *omissionRecorder) Skipf(format string, args ...any) { r.skip = fmt.Sprintf(format, args...) }

// One omitted input can match multiple known features. Every exclusion
// needs a receipt; recording just the first falsely expires the others.
func TestToolsOmissionsCountEveryFeature(t *testing.T) {
	t.Setenv("VIBELANG_FUZZ_PENDING", "")
	t.Setenv("VIBELANG_FUZZ_HANG_PROBE", "")
	previous := pendingEntries
	entries := []PendingEntry{
		{Target: "FuzzOmissionProbe", Key: "feature:compiler-gap-vip19", Owner: "compiler", Reason: "probe"},
		{Target: "FuzzOmissionProbe", Key: "feature:compiler-gap-vip20", Owner: "compiler", Reason: "probe"},
	}
	pendingEntries = func() ([]PendingEntry, error) { return entries, nil }
	t.Cleanup(func() {
		pendingEntries = previous
		for _, e := range entries {
			pendingUsed.Delete(e.Target + " " + e.Key)
		}
	})
	recorder := &omissionRecorder{}
	toolsSkipLeftOut(recorder, "FuzzOmissionProbe", map[string]string{"main.vibe": "// compiler-gap: pending VIP-19, VIP-20\nexport const n = 1\n"})
	for _, e := range entries {
		if _, used := pendingUsed.Load(e.Target + " " + e.Key); !used {
			t.Errorf("omission %s was not recorded", e.Key)
		}
		if !strings.Contains(recorder.skip, strings.TrimPrefix(e.Key, "feature:")) {
			t.Errorf("omission %s was not visible: %s", e.Key, recorder.skip)
		}
	}
}

func TestPendingSeedInputs(t *testing.T) {
	previous := pendingEntries
	entries := []PendingEntry{
		{Target: "FuzzSeedProbe", Key: "contract:first", Owner: "compiler"},
		{Target: "FuzzSeedProbe", Key: "resolve:second", Owner: "compiler"},
		{Target: "FuzzSeedProbe", Key: "feature:retired", Owner: Superseded},
	}
	pendingEntries = func() ([]PendingEntry, error) { return entries, nil }
	t.Cleanup(func() { pendingEntries = previous })
	probes := [][2]string{{"first-case", "contract:first"}, {"another-first", "contract:first"}, {"second-case", "resolve:second"}, {"ordinary-case", "contract:ordinary"}, {"retired-case", "feature:retired"}}
	got := pendingSeedInputs("FuzzSeedProbe", len(probes), func(i int) (string, string) { return probes[i][0], probes[i][1] })
	if !slices.Equal(got, []string{"first-case", "second-case"}) {
		t.Fatalf("pending witnesses: %v", got)
	}
	for _, entry := range entries {
		if _, used := pendingUsed.Load(entry.Target + " " + entry.Key); used {
			t.Errorf("selecting a seed falsely proved a gap: %s", entry.Key)
		}
	}
}

// TestSkipShortMatrixLeavesTargetUnjudged checks that a complete matrix
// skipped in a -short run keeps its target's lines out of the unused-line
// audit, since some keys are raised only there, and that the gate's
// VIBELANG_FUZZ_MATRIX runs the matrix.
func TestSkipShortMatrixLeavesTargetUnjudged(t *testing.T) {
	const target = "FuzzMatrixProbe"
	t.Cleanup(func() { pendingUnjudged.Delete(target) })
	all := func(string) bool { return true }
	entries := []PendingEntry{{Target: target, Key: "contract:matrix-only", Owner: "compiler", Reason: "raised only by the matrix"}}
	unused := func() []PendingEntry {
		return UnusedPending(entries, nil, judgedTargets(all), func(PendingEntry) bool { return false })
	}
	if len(unused()) != 1 {
		t.Fatalf("a target whose matrix did not skip was not judged: %v", unused())
	}
	t.Setenv("VIBELANG_FUZZ_MATRIX", "")
	ran := false
	t.Run("short", func(t *testing.T) {
		SkipShortMatrix(t, target, "VIBELANG_MATRIX_PROBE_UNSET", "probe")
		ran = true
	})
	if testing.Short() {
		if ran {
			t.Errorf("the matrix ran in a -short run without its variable")
		}
		if got := unused(); len(got) != 0 {
			t.Errorf("a line only the skipped matrix raises was judged unused: %v", got)
		}
	}
	pendingUnjudged.Delete(target)
	t.Setenv("VIBELANG_FUZZ_MATRIX", "1")
	ran = false
	t.Run("gate", func(t *testing.T) {
		SkipShortMatrix(t, target, "VIBELANG_MATRIX_PROBE_UNSET", "probe")
		ran = true
	})
	if !ran {
		t.Errorf("VIBELANG_FUZZ_MATRIX=1 did not run the matrix")
	}
}

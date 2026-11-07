package vibelang

import (
	stdmaps "maps"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// fixProgressLine is a line fixProgress prints.
var fixProgressLine = regexp.MustCompile(`^vibelang --fix: [0-9hms]+: (start|round [0-9]+|try( [0-9]+)?|effect|prelude|imports): [0-9]+ fix(es)? applied, [0-9]+ pending(, [0-9]+ refused)?; [0-9]+ checks?, [0-9]+ this (round|phase) \([0-9]+ whole, [0-9]+ partial\); (reading the project|finding fixes|finding rewrites|removing unused imports|checking the project|checking [0-9]+ fix(es)? in [0-9]+ files?|checking the rewrites of [0-9]+ files?) for [0-9hms]+(; (building program|program built|checking baseline|finding fixes|checking diagnostics|checking changed files|checking fixable files|diagnostics collected|finding remaining fix sites|comparing diagnostics|diagnostics compared|checking partial diagnostics|tracing error origins|finding rewrites|emitting declarations|finding declarations) for [0-9hms]+)?; heap [0-9]+ MiB, goal [0-9]+ MiB, [0-9]+ GCs$`)

// fixCostLine is the line a run that printed progress ends with: what it
// cost.
var fixCostLine = regexp.MustCompile(`^vibelang --fix: cost: [0-9hms]+; [0-9]+ checks? \([0-9]+ whole, [0-9]+ partial\); peak heap [0-9]+ MiB, [0-9]+ MiB from the system(; [0-9]+ checks? of changed files, [0-9]+ files each(, [0-9]+ differed)?)?(; whole for [a-z -]+ [0-9]+(, [a-z -]+ [0-9]+)*)?(; [a-z ]+ [0-9hms]+ \([0-9]+\)(, [a-z ]+ [0-9hms]+ \([0-9]+\))*)?$`)

// A --fix run says on stderr what it is doing, at most once each
// ProgressEvery: its phase and round, the fixes applied and pending, the
// checks begun and the size of the trial it checks (foldkit-63). Its
// report on stdout and the files it writes are those of a run that says
// nothing.
func TestFixPrintsProgressOnStderr(t *testing.T) {
	quiet := keepProject(t)
	silent := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: quiet}
	if status := FixWithOptions(t.Context(), silent, []string{"-p", quiet}, FixOptions{ProgressEvery: time.Hour}); status != 0 || silent.stderr.Len() != 0 {
		t.Fatalf("status %d, stderr %q", status, silent.stderr.String())
	}

	loud := keepProject(t)
	sys := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: loud}
	if status := FixWithOptions(t.Context(), sys, []string{"-p", loud}, FixOptions{ProgressEvery: 10 * time.Millisecond}); status != 0 {
		t.Fatalf("status %d, stderr %q", status, sys.stderr.String())
	}
	// A refusal names the other file by its absolute path, so the silent
	// run's report is read with its directory as the loud run's.
	if want := strings.ReplaceAll(silent.stdout.String(), quiet, loud); sys.stdout.String() != want {
		t.Fatalf("stdout %q; a run that says nothing prints %q", sys.stdout.String(), want)
	}
	if got, want := vibeFiles(t, loud), vibeFiles(t, quiet); !stdmaps.Equal(got, want) {
		t.Fatalf("wrote %v; a run that says nothing writes %v", got, want)
	}
	lines := strings.Split(strings.TrimSuffix(sys.stderr.String(), "\n"), "\n")
	for _, line := range lines[:len(lines)-1] {
		if !fixProgressLine.MatchString(line) {
			t.Fatalf("stderr line %q is not a progress line; stderr:\n%s", line, sys.stderr.String())
		}
	}
	// The last says what the run cost: its checks, its memory, and the
	// stages it spent its time in.
	if last := lines[len(lines)-1]; !fixCostLine.MatchString(last) {
		t.Fatalf("stderr ends with %q, not what the run cost; stderr:\n%s", last, sys.stderr.String())
	}
	stderr := sys.stderr.String()
	for _, want := range []*regexp.Regexp{
		regexp.MustCompile(`: round 1: 0 fixes applied, [1-9][0-9]* pending`),
		regexp.MustCompile(`: round [2-9]: [1-9][0-9]* fix(es)? applied`),
		regexp.MustCompile(`; checking [0-9]+ fix(es)? in [0-9]+ files? for `),
		regexp.MustCompile(`, 1 refused; `),
		regexp.MustCompile(`: round 1: .* checks?, [1-9][0-9]* this round \([1-9][0-9]* whole, `),
	} {
		if !want.MatchString(stderr) {
			t.Errorf("no progress line matches %s; stderr:\n%s", want, stderr)
		}
	}
}

// A run that ends before ProgressEvery prints no progress line.
func TestFixProgressQuietForAShortRun(t *testing.T) {
	var out strings.Builder
	p := newFixProgress(&out, time.Hour)
	p.enter("round", 1, 0, 0, "finding fixes")
	p.offered(3)
	p.checkFixes(3, 2)
	p.building()
	p.decided(2, 1)
	p.close()
	p.building() // after close: prints nothing, does not panic
	if out.Len() != 0 {
		t.Fatalf("printed %q", out.String())
	}
	var nilProgress *fixProgress
	nilProgress.enter("round", 1, 0, 0, "finding fixes")
	nilProgress.checkFixes(1, 1)
	nilProgress.building()
	nilProgress.close()
}

// A progress line counts the checks of its round, whole and of some files,
// apart from those of the run.
func TestFixProgressCountsTheChecksOfARound(t *testing.T) {
	var out strings.Builder
	p := newFixProgress(&out, time.Hour)
	defer p.close()
	p.building() // the baseline
	p.enter("round", 2, 5, 1, "finding fixes")
	p.checkFixes(4, 2)
	p.building()
	p.checkFixes(1, 1)
	p.partial()
	p.building()
	p.partial()
	p.building()
	p.partial()
	p.building()
	p.building() // clean in its files, so the whole program, built again
	p.mu.Lock()
	line := p.line(time.Now())
	p.mu.Unlock()
	if want := "; 6 checks, 5 this round (2 whole, 3 partial); "; !strings.Contains(line, want) {
		t.Fatalf("line %q does not say %q", line, want)
	}
	if !fixProgressLine.MatchString(line) {
		t.Fatalf("line %q is not a progress line", line)
	}
	p.enter("prelude", 0, 9, 1, "finding rewrites")
	p.mu.Lock()
	line = p.line(time.Now())
	p.mu.Unlock()
	if want := "; 6 checks, 0 this phase (0 whole, 0 partial); "; !strings.Contains(line, want) {
		t.Fatalf("line %q does not say %q", line, want)
	}
}

// Stage transitions retain the round and trial identity, so a slow diagnostic
// comparison cannot look like a checker that never returned.
func TestFixProgressIdentifiesStageAndHeap(t *testing.T) {
	var out strings.Builder
	p := newFixProgress(&out, time.Hour)
	defer p.close()
	p.enter("round", 4, 225, 99, "finding fixes")
	p.offered(2)
	p.checkFixes(2, 1)
	p.building()
	p.stage("comparing diagnostics")
	line := p.line(time.Now())
	for _, want := range []string{
		"round 4: 225 fixes applied, 2 pending, 99 refused",
		"1 check, 1 this round (1 whole, 0 partial)",
		"checking 2 fixes in 1 file",
		"comparing diagnostics for ",
		"; heap ", " MiB, goal ", " GCs",
	} {
		if !strings.Contains(line, want) {
			t.Errorf("missing %q in %q", want, line)
		}
	}
	if !fixProgressLine.MatchString(line) {
		t.Fatalf("invalid progress line: %q", line)
	}
	p.enter("round", 5, 227, 99, "finding fixes")
	if strings.Contains(p.line(time.Now()), "comparing diagnostics") {
		t.Fatal("stale stage survived a round transition")
	}
	var quiet *fixProgress
	quiet.stage("checking diagnostics")
}

// Sampling this short scan used to fail only when a timer tick landed in it.
// Exercise the real producer directly so the witness is independent of timing.
func TestFixProgressAcceptsRemainingFixSiteDiscovery(t *testing.T) {
	var out strings.Builder
	p := newFixProgress(&out, time.Hour)
	defer p.close()
	p.enter("prelude", 0, 11, 1, "finding rewrites")
	p.stage("finding remaining fix sites")
	line := p.line(time.Now())
	if !strings.Contains(line, "; finding remaining fix sites for ") {
		t.Fatalf("missing active discovery stage: %q", line)
	}
	if !fixProgressLine.MatchString(line) {
		t.Fatalf("valid discovery progress line rejected: %q", line)
	}
	for _, invalid := range []string{
		strings.Replace(line, "finding remaining fix sites", "finding remaining fix sites unexpectedly", 1),
		strings.Replace(line, ": prelude:", ": unknown:", 1),
		strings.Split(line, "; heap ")[0],
	} {
		if invalid == line {
			t.Fatalf("negative control did not modify %q", line)
		}
		if fixProgressLine.MatchString(invalid) {
			t.Fatalf("malformed progress line accepted: %q", invalid)
		}
	}
}

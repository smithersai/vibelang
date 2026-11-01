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
var fixProgressLine = regexp.MustCompile(`^vibelang --fix: [0-9hms]+: (start|round [0-9]+|try( [0-9]+)?|effect|prelude|imports): [0-9]+ fix(es)? applied, [0-9]+ pending(, [0-9]+ refused)?; [0-9]+ checks?, [0-9]+ this (round|phase) \([0-9]+ whole, [0-9]+ partial\); (reading the project|finding fixes|finding rewrites|removing unused imports|checking the project|checking [0-9]+ fix(es)? in [0-9]+ files?|checking the rewrites of [0-9]+ files?) for [0-9hms]+$`)

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
	for _, line := range lines {
		if !fixProgressLine.MatchString(line) {
			t.Fatalf("stderr line %q is not a progress line; stderr:\n%s", line, sys.stderr.String())
		}
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
	p.widened() // clean in its files, so it goes on to the program
	p.mu.Lock()
	line := p.line(time.Now())
	p.mu.Unlock()
	if want := "; 5 checks, 4 this round (2 whole, 2 partial); "; !strings.Contains(line, want) {
		t.Fatalf("line %q does not say %q", line, want)
	}
	if !fixProgressLine.MatchString(line) {
		t.Fatalf("line %q is not a progress line", line)
	}
	p.enter("prelude", 0, 9, 1, "finding rewrites")
	p.mu.Lock()
	line = p.line(time.Now())
	p.mu.Unlock()
	if want := "; 5 checks, 0 this phase (0 whole, 0 partial); "; !strings.Contains(line, want) {
		t.Fatalf("line %q does not say %q", line, want)
	}
}

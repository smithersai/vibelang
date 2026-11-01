package vibelang

import (
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

// fixProgressEvery is how often a --fix run says on stderr what it is
// doing when FixOptions.ProgressEvery is 0. A run that ends sooner says
// nothing.
const fixProgressEvery = 5 * time.Second

// A fixProgress prints what a --fix run is doing to stderr, at most once
// each interval (foldkit-63). A run on a large package checks it for
// hours, and it printed nothing before its report, so a driver could not
// tell it from a hang. A line names the time since the start, the phase
// and its round, the fixes applied, pending and refused, the checks of the
// program begun, and what the run is doing and for how long:
//
//	vibelang --fix: 4m10s: round 3: 41 fixes applied, 20 pending, 3 refused; 17 checks; checking 23 fixes in 9 files for 6s
//
// A ticker prints during a long check. The report on stdout is as it was.
// A nil fixProgress prints nothing.
type fixProgress struct {
	w     io.Writer
	every time.Duration
	stop  chan struct{}
	done  sync.WaitGroup

	mu       sync.Mutex
	start    time.Time
	printed  time.Time
	phase    string
	round    int
	applied  int
	pending  int
	refused  int
	checks   int
	next     string // what the next program built is for
	activity string
	since    time.Time
}

// newFixProgress returns the progress of a run that prints to w each
// every, or each fixProgressEvery when every is 0; nil when w is nil.
// close stops it.
func newFixProgress(w io.Writer, every time.Duration) *fixProgress {
	if w == nil {
		return nil
	}
	if every <= 0 {
		every = fixProgressEvery
	}
	start := time.Now()
	p := &fixProgress{w: w, every: every, stop: make(chan struct{}), start: start, printed: start, since: start, phase: "start", activity: "reading the project"}
	ticker := time.NewTicker(every)
	p.done.Add(1)
	go func() {
		defer p.done.Done()
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				p.update(func() {})
			case <-p.stop:
				return
			}
		}
	}()
	return p
}

// close stops the ticker; nothing prints once it returns.
func (p *fixProgress) close() {
	if p == nil {
		return
	}
	close(p.stop)
	p.done.Wait()
	p.mu.Lock()
	p.w = nil
	p.mu.Unlock()
}

// update applies change, and prints a line when the last is every old.
func (p *fixProgress) update(change func()) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	change()
	if p.w == nil {
		return
	}
	now := time.Now()
	if now.Sub(p.printed) < p.every {
		return
	}
	p.printed = now
	fmt.Fprintln(p.w, p.line(now))
}

func (p *fixProgress) line(now time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "vibelang --fix: %s: %s", now.Sub(p.start).Round(time.Second), p.phase)
	if p.round > 0 {
		fmt.Fprintf(&b, " %d", p.round)
	}
	fmt.Fprintf(&b, ": %d %s applied, %d pending", p.applied, plural(p.applied, "fix", "fixes"), p.pending)
	if p.refused > 0 {
		fmt.Fprintf(&b, ", %d refused", p.refused)
	}
	fmt.Fprintf(&b, "; %d %s; %s for %s", p.checks, plural(p.checks, "check", "checks"), p.activity, now.Sub(p.since).Round(time.Second))
	return b.String()
}

func (p *fixProgress) doing(activity string) {
	p.activity, p.since = activity, time.Now()
}

// enter starts phase, in round when it is not 0, with the fixes applied
// and refused so far, and what it does first.
func (p *fixProgress) enter(phase string, round, applied, refused int, activity string) {
	p.update(func() {
		p.phase, p.round, p.applied, p.pending, p.refused = phase, round, applied, 0, refused
		p.doing(activity)
	})
}

// offered sets the fixes the round offers.
func (p *fixProgress) offered(fixes int) {
	p.update(func() { p.pending = fixes })
}

// decided moves fixes the gate kept and refused out of pending.
func (p *fixProgress) decided(kept, refused int) {
	p.update(func() {
		p.pending = max(0, p.pending-kept-refused)
		p.applied += kept
		p.refused += refused
	})
}

// checkFixes names the next program built: a trial of fixes in files.
func (p *fixProgress) checkFixes(fixes, files int) {
	p.label(fmt.Sprintf("checking %d %s in %d %s", fixes, plural(fixes, "fix", "fixes"), files, plural(files, "file", "files")))
}

// checkFiles names the next program built: the rewrites of files.
func (p *fixProgress) checkFiles(files int) {
	p.label(fmt.Sprintf("checking the rewrites of %d %s", files, plural(files, "file", "files")))
}

// label names the next program built, or clears the name when it is "".
func (p *fixProgress) label(next string) {
	if p != nil {
		p.mu.Lock()
		p.next = next
		p.mu.Unlock()
	}
}

// building begins a check: of the program the last label named, or of
// the project.
func (p *fixProgress) building() {
	p.update(func() {
		p.checks++
		if p.next == "" {
			p.next = "checking the project"
		}
		p.doing(p.next)
		p.next = ""
	})
}

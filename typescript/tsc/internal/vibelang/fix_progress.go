package vibelang

import (
	"cmp"
	"fmt"
	"io"
	stdmaps "maps"
	"runtime"
	"slices"
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
// program begun, in all and in this round or phase, whole or of only the
// files that report an error, and what the run is doing and for how long:
//
//	vibelang --fix: 4m10s: round 3: 41 fixes applied, 20 pending, 3 refused; 17 checks, 6 this round (2 whole, 4 partial); checking 23 fixes in 9 files for 6s
//
// The checks of a round should not grow with the project: a round that
// checks the whole program once for each fix it refuses grows with the
// square of it.
//
// A ticker prints during a long check. When a run that printed a line
// ends, it prints what it cost: its time, its checks, the largest heap
// the ticker saw, and the time it spent in each stage, most first
// (fixProgress.cost):
//
//	vibelang --fix: cost: 12m15s; 55 checks (20 whole, 35 partial); peak heap 9607 MiB, 11002 MiB from the system; checking diagnostics 6m2s (20), building program 1m30s (55), ...
//
// The report on stdout is as it was. A nil fixProgress prints nothing.
type fixProgress struct {
	w     io.Writer
	every time.Duration
	stop  chan struct{}
	done  sync.WaitGroup

	mu      sync.Mutex
	start   time.Time
	printed time.Time
	phase   string
	round   int
	applied int
	pending int
	refused int
	checks  int
	// The checks begun in this round or phase, and those of some files.
	phaseChecks  int
	phasePartial int
	next         string // what the next program built is for
	nextPartial  bool   // the next program built is checked in some files
	stageName    string
	stageSince   time.Time
	activity     string
	since        time.Time
	// The time the run spent in each stage, or in its phase when no stage
	// is named, the times it entered each, and when the time was last
	// charged (charge); the peak heap and memory from the system the
	// ticker saw.
	spent            map[string]time.Duration
	entered          map[string]int
	charged          time.Time
	whole            int
	peakHeap, peakOS uint64
	// The checks of only the files a trial changed and their readers, the
	// files they checked, those a check of the whole program was made
	// again for, and those whose errors it found different
	// (fix_incremental.go).
	changedChecks, changedFiles, changedDiffered int
	changedWhole                                 map[string]int
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
	p := &fixProgress{w: w, every: every, stop: make(chan struct{}), start: start, printed: start, since: start, phase: "start", activity: "reading the project", spent: map[string]time.Duration{}, entered: map[string]int{}, charged: start}
	ticker := time.NewTicker(every)
	p.done.Add(1)
	go func() {
		defer p.done.Done()
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				var memory runtime.MemStats
				runtime.ReadMemStats(&memory)
				p.update(func() {
					p.peakHeap = max(p.peakHeap, memory.HeapAlloc)
					p.peakOS = max(p.peakOS, memory.Sys-memory.HeapReleased)
				})
			case <-p.stop:
				return
			}
		}
	}()
	return p
}

// close stops the ticker and, when the run printed a line, prints what
// it cost; nothing prints once it returns.
func (p *fixProgress) close() {
	if p == nil {
		return
	}
	close(p.stop)
	p.done.Wait()
	p.mu.Lock()
	if p.w != nil && p.printed.After(p.start) {
		fmt.Fprintln(p.w, p.cost(time.Now()))
	}
	p.w = nil
	p.mu.Unlock()
}

// charge adds the time since it last charged to the stage, or the phase
// when no stage is named.
func (p *fixProgress) charge(now time.Time) {
	name := p.stageName
	if name == "" {
		name = p.phase
	}
	p.spent[name] += now.Sub(p.charged)
	p.charged = now
}

// cost says what the run cost to now: its time, its checks, its peak
// memory, and the time of each stage it spent at least a second in.
func (p *fixProgress) cost(now time.Time) string {
	p.charge(now)
	var b strings.Builder
	fmt.Fprintf(&b, "vibelang --fix: cost: %s; %d %s (%d whole, %d partial); peak heap %d MiB, %d MiB from the system", now.Sub(p.start).Round(time.Second), p.checks, plural(p.checks, "check", "checks"), p.whole, p.checks-p.whole, p.peakHeap>>20, p.peakOS>>20)
	if p.changedChecks > 0 {
		fmt.Fprintf(&b, "; %d %s of changed files, %d files each", p.changedChecks, plural(p.changedChecks, "check", "checks"), p.changedFiles/p.changedChecks)
		if p.changedDiffered > 0 {
			fmt.Fprintf(&b, ", %d differed", p.changedDiffered)
		}
	}
	if len(p.changedWhole) > 0 {
		reasons := slices.Sorted(stdmaps.Keys(p.changedWhole))
		for i, why := range reasons {
			reasons[i] = fmt.Sprintf("%s %d", why, p.changedWhole[why])
		}
		fmt.Fprintf(&b, "; whole for %s", strings.Join(reasons, ", "))
	}
	names := make([]string, 0, len(p.spent))
	for name, spent := range p.spent {
		if spent >= time.Second {
			names = append(names, name)
		}
	}
	slices.SortFunc(names, func(a, c string) int {
		if n := cmp.Compare(p.spent[c], p.spent[a]); n != 0 {
			return n
		}
		return strings.Compare(a, c)
	})
	for i, name := range names {
		sep := ", "
		if i == 0 {
			sep = "; "
		}
		fmt.Fprintf(&b, "%s%s %s (%d)", sep, name, p.spent[name].Round(time.Second), p.entered[name])
	}
	return b.String()
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
	this := "phase"
	if p.round > 0 {
		this = "round"
	}
	fmt.Fprintf(&b, "; %d %s, %d this %s (%d whole, %d partial); %s for %s", p.checks, plural(p.checks, "check", "checks"), p.phaseChecks, this, p.phaseChecks-p.phasePartial, p.phasePartial, p.activity, now.Sub(p.since).Round(time.Second))
	if p.stageName != "" {
		fmt.Fprintf(&b, "; %s for %s", p.stageName, now.Sub(p.stageSince).Round(time.Second))
	}
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	fmt.Fprintf(&b, "; heap %d MiB, goal %d MiB, %d GCs", memory.HeapAlloc>>20, memory.NextGC>>20, memory.NumGC)
	return b.String()
}

func (p *fixProgress) doing(activity string) {
	now := time.Now()
	p.charge(now)
	p.activity, p.since = activity, now
	p.stageName, p.stageSince = "", now
}

// enter starts phase, in round when it is not 0, with the fixes applied
// and refused so far, and what it does first.
func (p *fixProgress) enter(phase string, round, applied, refused int, activity string) {
	p.update(func() {
		p.charge(time.Now())
		p.phase, p.round, p.applied, p.pending, p.refused = phase, round, applied, 0, refused
		p.phaseChecks, p.phasePartial = 0, 0
		p.doing(activity)
		p.entered[phase]++
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

// partial says the next program built is checked only in the files that
// report an error.
func (p *fixProgress) partial() {
	if p != nil {
		p.mu.Lock()
		p.nextPartial = true
		p.mu.Unlock()
	}
}

// label names the next program built, or clears the name when it is "".
func (p *fixProgress) label(next string) {
	if p != nil {
		p.mu.Lock()
		p.next = next
		if next == "" {
			p.nextPartial = false // the last build reused its program
		}
		p.mu.Unlock()
	}
}

// building begins a check: of the program the last label named, or of
// the project.
func (p *fixProgress) building() {
	p.update(func() {
		p.checks++
		p.phaseChecks++
		if p.nextPartial {
			p.phasePartial++
		} else {
			p.whole++
		}
		p.nextPartial = false
		if p.next == "" {
			p.next = "checking the project"
		}
		p.doing(p.next)
		p.stageName, p.stageSince = "building program", p.since
		p.entered[p.stageName]++
		p.next = ""
	})
}

// checkedChanged says the last program built, which building counted
// whole, was checked only in the files it changed and their readers, files
// files of it.
func (p *fixProgress) checkedChanged(files int) {
	p.update(func() {
		if p.whole > 0 && p.phasePartial < p.phaseChecks {
			p.whole--
			p.phasePartial++
		}
		p.changedChecks++
		p.changedFiles += files
	})
}

// wholeInstead says a check of the whole program stands in for a check of
// the changed files, and why.
func (p *fixProgress) wholeInstead(why string) {
	p.update(func() {
		if p.changedWhole == nil {
			p.changedWhole = map[string]int{}
		}
		p.changedWhole[why]++
	})
}

// differed prints line, which says a check of the whole program found
// other errors than a check of the changed files, and counts it.
func (p *fixProgress) differed(line string) {
	p.update(func() {
		p.changedDiffered++
		if p.w != nil {
			fmt.Fprintln(p.w, line)
		}
	})
}

// stage distinguishes program construction, checking and fix analysis within
// the same trial. It contains only a fixed label, never source text or paths.
func (p *fixProgress) stage(name string) {
	p.update(func() {
		now := time.Now()
		p.charge(now)
		p.stageName, p.stageSince = name, now
		p.entered[name]++
	})
}

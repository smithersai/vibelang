package vibelang

import (
	"fmt"
	"io"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Refused sites (fuzz-coverage spec, 2026-11-03). A refused site is the span
// of one diagnostic vibelang --fix declines to repair: its fix would add an
// error, its fix would edit another refused site, or the run ends with it
// still there and no fix for it. Refusals
// are per site, so a file can hold refused sites and fixes elsewhere. The
// rule: a refused site's bytes are the same before and after --fix, and no
// edit overlaps it; an edit before it may move it. The fixer refuses each fix
// whose edits touch a refused site, and a site that changes anyway is a
// vibelang bug: its file keeps its text from before --fix, and the command
// exits 3. vibelang --fix prints one line per site:
//
//	vibelang --fix: refused site: src/a.vibe:12:3-12:40 [281,318) EK2128: <reason>
//
// The span is in the file as it stood before the run: 1-based lines, columns
// in UTF-16 code units as the compiler's diagnostics count them, and
// [start,end) in bytes. A site in text an earlier fix of the run wrote is
// marked "EK2128 new"; its span is the original text that fix replaced.

// A RefusedSite is one site --fix declined, in the file before the run.
type RefusedSite struct {
	File                   tspath.RootedFilePath
	Start, End             int // bytes
	StartLine, StartColumn int // 1-based; columns in UTF-16 code units
	EndLine, EndColumn     int
	Code                   string // EK2128, or a rewrite's label
	New                    bool   // in text an earlier fix of the run wrote
	Reason                 string
}

// A trackedSite is a site with the text it was declined in and its span
// there, which later texts are compared with.
type trackedSite struct {
	RefusedSite
	seen       string
	start, end int
	resolved   bool // its own fix was accepted for a later round
}

type fixSites struct {
	original func(tspath.RootedFilePath) string
	sites    map[tspath.RootedFilePath][]*trackedSite
}

func newFixSites(original func(tspath.RootedFilePath) string) *fixSites {
	return &fixSites{original: original, sites: map[tspath.RootedFilePath][]*trackedSite{}}
}

// add records the site [start, end) of current, the text of name it was
// declined in, unless it is already recorded.
func (s *fixSites) add(name tspath.RootedFilePath, current string, start, end int, code, reason string) {
	original := s.original(name)
	os, oe, isNew := start, end, false
	if current != original {
		os, oe, isNew = spanBefore(textHunks(original, current), start, end)
	}
	for _, t := range s.sites[name] {
		if !t.resolved && t.Start == os && t.End == oe && t.Code == code {
			return
		}
	}
	site := RefusedSite{File: name, Start: os, End: oe, Code: code, New: isNew, Reason: reason}
	site.StartLine, site.StartColumn = lineColumn(original, os)
	site.EndLine, site.EndColumn = lineColumn(original, oe)
	s.sites[name] = append(s.sites[name], &trackedSite{RefusedSite: site, seen: current, start: start, end: end})
}

// live returns the sites of name that hold in current, with their spans there.
func (s *fixSites) live(name tspath.RootedFilePath, current string) (sites []*trackedSite, spans [][2]int) {
	hunks := map[string][]textHunk{}
	for _, t := range s.sites[name] {
		if t.resolved {
			continue
		}
		h, ok := hunks[t.seen]
		if !ok {
			h = textHunks(t.seen, current)
			hunks[t.seen] = h
		}
		if start, end, ok := spanAfter(t.seen, current, h, t.start, t.end); ok {
			sites = append(sites, t)
			spans = append(spans, [2]int{start, end})
		}
	}
	return sites, spans
}

// guard returns the fixes of name, whose text is current, that touch no live
// site, and the others with the site each would edit. A fix of a site's own
// diagnostic repairs it: the site is resolved, and comes back if the gate
// refuses that fix.
func (s *fixSites) guard(name tspath.RootedFilePath, current string, fixes []fileFix) (kept []fileFix, blocked []fileFix, by []*trackedSite) {
	sites, spans := s.live(name, current)
	if len(sites) == 0 {
		return fixes, nil, nil
	}
	for _, f := range fixes {
		start, end := fixSiteSpan(f)
		var hit *trackedSite
		for i, t := range sites {
			if f.sited && spans[i] == [2]int{start, end} && t.Code == fixCodeName(f.code) {
				t.resolved = true
				continue
			}
			if slices.ContainsFunc(f.edits, func(e sourceEdit) bool { return spanTouches(e.start, e.end, spans[i][0], spans[i][1]) }) {
				hit = t
				break
			}
		}
		if hit == nil {
			kept = append(kept, f)
		} else {
			blocked, by = append(blocked, f), append(by, hit)
		}
	}
	return kept, blocked, by
}

// check returns the sites of name that final changed. A site whose file a
// fix never changed holds.
func (s *fixSites) check(name tspath.RootedFilePath, final string) []RefusedSite {
	var changed []RefusedSite
	sites, _ := s.live(name, final)
	for _, t := range s.sites[name] {
		if !t.resolved && !slices.Contains(sites, t) {
			changed = append(changed, t.RefusedSite)
		}
	}
	return changed
}

// all returns the unresolved sites, by file and position.
func (s *fixSites) all() []RefusedSite {
	var all []RefusedSite
	for _, sites := range s.sites {
		for _, t := range sites {
			if !t.resolved {
				all = append(all, t.RefusedSite)
			}
		}
	}
	slices.SortFunc(all, compareSites)
	return all
}

func compareSites(a, b RefusedSite) int {
	if c := a.File.Compare(b.File); c != 0 {
		return c
	}
	if a.Start != b.Start {
		return a.Start - b.Start
	}
	if a.End != b.End {
		return a.End - b.End
	}
	return strings.Compare(a.Code, b.Code)
}

// fixSiteSpan is the span of the diagnostic f repairs, or of its edits.
func fixSiteSpan(f fileFix) (int, int) {
	if f.sited {
		return f.siteStart, f.siteEnd
	}
	start, end := firstEdit(f.edits), 0
	for _, e := range f.edits {
		end = max(end, e.end)
	}
	return start, end
}

// spanTouches reports whether the range [es, ee) an edit replaces touches
// the site [s, e): it overlaps it, or inserts inside it. An edit that ends
// where the site starts, or starts where it ends, leaves its bytes.
func spanTouches(es, ee, s, e int) bool {
	switch {
	case s == e:
		return es < s && s < ee
	case es == ee:
		return s < es && es < e
	default:
		return es < e && s < ee
	}
}

// SiteHolds reports whether site, a span of before, keeps its bytes in after,
// for guards and fuzz targets that hold the texts before and after vibelang
// --fix. Texts alone cannot show which edit touched what, so it only says
// whether the bytes stand; the fixer itself refuses every fix whose edits
// overlap a site (fixSites.guard).
func SiteHolds(before, after string, site RefusedSite) bool {
	if site.New || site.Start < 0 || site.End > len(before) || site.Start > site.End {
		return true // a site --fix wrote has no bytes before the run
	}
	_, _, ok := spanAfter(before, after, textHunks(before, after), site.Start, site.End)
	return ok
}

// A textHunk is one change from a to b: a[aStart:aEnd] became b[bStart:bEnd].
type textHunk struct{ aStart, aEnd, bStart, bEnd int }

// spanAfter maps [s, e) of a to b through hunks, or reports false when a
// hunk touches it and its bytes are gone from b.
func spanAfter(a, b string, hunks []textHunk, s, e int) (int, int, bool) {
	delta, touched := 0, false
	for _, h := range hunks {
		switch {
		case spanTouches(h.aStart, h.aEnd, s, e):
			touched = true
		case !touched && h.aEnd <= s && !(h.aStart == h.aEnd && h.aStart == s && s == e):
			delta += (h.bEnd - h.bStart) - (h.aEnd - h.aStart)
		}
	}
	if !touched {
		return s + delta, e + delta, true
	}
	// A diff cannot tell which of two equal alignments the edits took, so
	// a site a hunk touches holds while its bytes stand anywhere in b: the
	// occurrence nearest its place is taken. The fixer refuses every fix
	// whose edits overlap a site (guard); this is the backstop for the
	// rewrites, and it must never call an untouched site changed.
	site, want, best := a[s:e], s+delta, -1
	for at := 0; at+len(site) <= len(b); at++ {
		i := strings.Index(b[at:], site)
		if i < 0 {
			break
		}
		at += i
		if best < 0 || distance(at, want) < distance(best, want) {
			best = at
		}
		if at > want {
			break
		}
	}
	if best < 0 {
		return 0, 0, false
	}
	return best, best + len(site), true
}

func distance(a, b int) int { return max(a-b, b-a) }

// spanBefore maps [s, e) of b back to a through hunks. A span a hunk
// touches widens to the text of a that hunk replaced, and is new.
func spanBefore(hunks []textHunk, s, e int) (int, int, bool) {
	start, end, isNew := s, e, false
	startDelta, endDelta := 0, 0
	startSet, endSet := false, false
	for _, h := range hunks {
		grow := (h.bEnd - h.bStart) - (h.aEnd - h.aStart)
		if spanTouches(h.bStart, h.bEnd, s, e) || s == e && h.bStart < s && s < h.bEnd {
			isNew = true
		}
		if !startSet {
			switch {
			case h.bStart < s && s < h.bEnd:
				start, startSet = h.aStart, true
			case h.bEnd <= s:
				startDelta += grow
			default:
				start, startSet = s-startDelta, true
			}
		}
		if !endSet {
			switch {
			case h.bStart < e && e < h.bEnd:
				end, endSet = h.aEnd, true
			case h.bEnd < e || h.bEnd == e && h.bStart < e:
				endDelta += grow
			default:
				end, endSet = e-endDelta, true
			}
		}
	}
	if !startSet {
		start = s - startDelta
	}
	if !endSet {
		end = e - endDelta
	}
	return start, max(start, end), isNew
}

// textHunks returns the changes from a to b, in order: a line diff of what
// lies between their common prefix and suffix, each changed run of lines
// trimmed to the bytes that differ. Past maxDiffEdits lines of difference
// the whole middle is one hunk, which can only touch more sites.
func textHunks(a, b string) []textHunk {
	if a == b {
		return nil
	}
	prefix, suffix := unchangedEnds(a, b)
	am, bm := a[prefix:len(a)-suffix], b[prefix:len(b)-suffix]
	al, bl := splitLines(am), splitLines(bm)
	matches, ok := lineMatches(al, bl, maxDiffEdits)
	if !ok {
		return []textHunk{{prefix, len(a) - suffix, prefix, len(b) - suffix}}
	}
	aStarts, bStarts := lineStarts(al, prefix), lineStarts(bl, prefix)
	var hunks []textHunk
	i, j := 0, 0
	for _, m := range append(matches, [2]int{len(al), len(bl)}) {
		if m[0] > i || m[1] > j {
			h := textHunk{aStarts[i], aStarts[m[0]], bStarts[j], bStarts[m[1]]}
			for h.aStart < h.aEnd && h.bStart < h.bEnd && a[h.aStart] == b[h.bStart] {
				h.aStart, h.bStart = h.aStart+1, h.bStart+1
			}
			for h.aStart < h.aEnd && h.bStart < h.bEnd && a[h.aEnd-1] == b[h.bEnd-1] {
				h.aEnd, h.bEnd = h.aEnd-1, h.bEnd-1
			}
			hunks = append(hunks, h)
		}
		i, j = m[0]+1, m[1]+1
	}
	return hunks
}

const maxDiffEdits = 4000

func splitLines(s string) []string {
	var lines []string
	for len(s) > 0 {
		n := strings.IndexByte(s, '\n') + 1
		if n == 0 {
			n = len(s)
		}
		lines, s = append(lines, s[:n]), s[n:]
	}
	return lines
}

// lineStarts returns the offset of each line, and of the end, from base.
func lineStarts(lines []string, base int) []int {
	starts := make([]int, 0, len(lines)+1)
	for _, l := range lines {
		starts = append(starts, base)
		base += len(l)
	}
	return append(starts, base)
}

// lineMatches returns the pairs of equal lines of a longest common
// subsequence of a and b, in order (Myers' O((N+M)D) algorithm), or false
// when they differ by more than maxD lines.
func lineMatches(a, b []string, maxD int) ([][2]int, bool) {
	n, m := len(a), len(b)
	off := n + m + 1
	v := make([]int, 2*off+1)
	var trace [][]int // trace[d][k+d] is v[k] after step d
	for d := 0; d <= n+m; d++ {
		if d > maxD {
			return nil, false
		}
		for k := -d; k <= d; k += 2 {
			var x int
			if k == -d || k != d && v[off+k-1] < v[off+k+1] {
				x = v[off+k+1]
			} else {
				x = v[off+k-1] + 1
			}
			y := x - k
			for x < n && y < m && a[x] == b[y] {
				x, y = x+1, y+1
			}
			v[off+k] = x
			if x >= n && y >= m {
				return backtrackMatches(trace, n, m, d), true
			}
		}
		trace = append(trace, slices.Clone(v[off-d:off+d+1]))
	}
	return nil, false
}

func backtrackMatches(trace [][]int, x, y, d int) [][2]int {
	var matches [][2]int
	for ; d > 0; d-- {
		prev := trace[d-1]
		at := func(k int) int { return prev[k+d-1] }
		k := x - y
		var pk int
		if k == -d || k != d && at(k-1) < at(k+1) {
			pk = k + 1
		} else {
			pk = k - 1
		}
		px := at(pk)
		xs := px
		if pk == k-1 {
			xs = px + 1
		}
		for x > xs && y > xs-k {
			x, y = x-1, y-1
			matches = append(matches, [2]int{x, y})
		}
		x, y = px, px-pk
	}
	for x > 0 && y > 0 {
		x, y = x-1, y-1
		matches = append(matches, [2]int{x, y})
	}
	slices.Reverse(matches)
	return matches
}

// lineColumn returns the 1-based line and UTF-16 column of pos in text.
func lineColumn(text string, pos int) (int, int) {
	pos = min(max(pos, 0), len(text))
	before := text[:pos]
	start := strings.LastIndexByte(before, '\n') + 1
	column := 1
	for _, r := range before[start:] {
		column++
		if r >= 0x10000 && r != utf8.RuneError {
			column++
		}
	}
	return strings.Count(before, "\n") + 1, column
}

// reportSites writes one line per site, and one per site a rewrite changed.
func reportSites(w io.Writer, sites, changed []RefusedSite, name func(tspath.RootedFilePath) string) {
	for _, site := range sites {
		fmt.Fprintf(w, "vibelang --fix: refused site: %s: %s\n", siteText(site, name), site.Reason)
	}
	for _, site := range changed {
		fmt.Fprintf(w, "vibelang --fix: refused site changed: %s: a vibelang bug; %s keeps its text from before --fix\n", siteText(site, name), name(site.File))
	}
}

func siteText(site RefusedSite, name func(tspath.RootedFilePath) string) string {
	code := site.Code
	if site.New {
		code += " new"
	}
	return fmt.Sprintf("%s:%d:%d-%d:%d [%d,%d) %s", name(site.File), site.StartLine, site.StartColumn, site.EndLine, site.EndColumn, site.Start, site.End, code)
}

// lineSpan returns the span of the 1-based line of text, without its newline.
func lineSpan(text string, line int) (int, int) {
	start := 0
	for i := 1; i < line; i++ {
		n := strings.IndexByte(text[start:], '\n')
		if n < 0 {
			return len(text), len(text)
		}
		start += n + 1
	}
	end := strings.IndexByte(text[start:], '\n')
	if end < 0 {
		return start, len(text)
	}
	return start, start + end
}

// declineReason is why --fix leaves d: its first note that is not a fix's.
func declineReason(d *ast.Diagnostic) string {
	for _, n := range d.MessageChain() {
		if text := n.MessageText(); text != "" && !strings.Contains(text, "quick fix writes") {
			return "no fix applies: " + text
		}
	}
	return "no fix applies"
}

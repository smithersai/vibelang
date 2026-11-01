package vibelang

import (
	"crypto/sha256"
	"fmt"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// accept returns proposals cut down to the fixes that, together, add no
// error, and calls refuse for each fix that adds one to them. It checks the
// round as a whole first. When that adds errors, it peels the round
// (gateRound.peel): the fixes whose own text holds an added error are set
// aside and the rest checked again, until the rest passes and is kept;
// then the fixes set aside are checked on top of it the same way, and
// refused when each holds the errors they add. An error in no fix's text
// is traced to the fix it reads a declaration of (gateRound.culprit). A fix
// an earlier round refused on its own is refused again without a check
// when this round offers it to the same texts (fixGate.alone). A round so
// costs a few checks of the program, however many fixes it refuses, where
// halving it cost two or more for each.
func (g *fixGate) accept(texts map[tspath.RootedFilePath]string, proposals []proposal, refuse func(FixRefusal, string)) []proposal {
	r := &gateRound{g: g, texts: texts, proposals: proposals, kept: map[int][]int{}}
	var all []part
	for i, p := range proposals {
		var fixes []int
		for f := range p.fixes {
			if added, ok := g.alone[r.aloneKey(i, []int{f})]; ok {
				r.refuse([2]int{i, f}, added)
			} else {
				fixes = append(fixes, f)
			}
		}
		if len(fixes) > 0 {
			all = append(all, part{i, fixes})
		}
	}
	if len(all) == 0 {
		return r.finish(make([]int, len(proposals)), refuse)
	}
	t := r.trial(all, nil)
	if len(t.added) == 0 {
		if len(r.refusals) == 0 {
			return proposals
		}
		r.keep(all...)
		return r.finish(make([]int, len(proposals)), refuse)
	}
	// Refusals are reported as halving the whole round found them: the
	// files that report none of the errors it adds first.
	class := make([]int, len(proposals))
	for i, p := range proposals {
		if reportsAny(t.added, p.file.FileName()) {
			class[i] = 1
		}
	}
	if !slices.Contains(class, 0) {
		clear(class)
	}
	r.peel(all, t)
	return r.finish(class, refuse)
}

// acceptEach is accept as D291 words it, with a check for each fix: in
// order, each fix is kept when it adds no error to the fixes kept before
// it, and refused otherwise. It is the oracle accept is fuzzed against
// (FixOptions.CheckEachFix).
func (g *fixGate) acceptEach(texts map[tspath.RootedFilePath]string, proposals []proposal, refuse func(FixRefusal, string)) []proposal {
	r := &gateRound{g: g, texts: texts, proposals: proposals, kept: map[int][]int{}}
	for i, p := range proposals {
		for f := range p.fixes {
			if g.done.Err() != nil {
				break
			}
			fix := part{i, []int{f}}
			if t := r.trial([]part{fix}, nil); len(t.added) > 0 {
				r.refuse([2]int{i, f}, t.added)
			} else {
				r.keep(fix)
			}
		}
	}
	return r.finish(make([]int, len(proposals)), refuse)
}

// finish reports the refusals of the round, ordered by class, proposal and
// fix, and returns the proposals cut down to the fixes it kept.
func (r *gateRound) finish(class []int, refuse func(FixRefusal, string)) []proposal {
	slices.SortStableFunc(r.refusals, func(a, b gateRefusal) int {
		if c := class[a.at[0]] - class[b.at[0]]; c != 0 {
			return c
		}
		if c := a.at[0] - b.at[0]; c != 0 {
			return c
		}
		return a.at[1] - b.at[1]
	})
	for _, refusal := range r.refusals {
		p := r.proposals[refusal.at[0]]
		fix := p.fixes[refusal.at[1]]
		line, _ := scannerLineOf(p.file, firstEdit(fix.edits))
		refuse(FixRefusal{File: p.file.FileName(), Line: line + 1, Code: fix.code, Error: refusal.error}, fix.key)
	}
	var accepted []proposal
	for i := range r.proposals {
		if fixes := r.kept[i]; len(fixes) > 0 {
			accepted = append(accepted, r.subset(i, fixes))
		}
	}
	return accepted
}

// A gateRound is one round of fixGate.accept: the fixes it has kept and
// refused, by proposal and fix index.
type gateRound struct {
	g         *fixGate
	texts     map[tspath.RootedFilePath]string
	proposals []proposal
	kept      map[int][]int
	refusals  []gateRefusal
	textsKey  []byte
}

// A gateRefusal is a fix that adds errors, and the first of them.
type gateRefusal struct {
	at    [2]int
	error string
}

// A part is some of a proposal's fixes, by index.
type part struct {
	p     int
	fixes []int
}

// A checked trial is the program of the kept fixes and some others, the
// fixes it applies by proposal, its errors, and the errors it adds by key
// and number. A trial of some files counts only their errors.
type checked struct {
	program *compiler.Program
	fixes   map[int][]int
	errors  []*ast.Diagnostic
	added   map[string]int
}

// subset returns proposal p with only fixes, in their order.
func (r *gateRound) subset(p int, fixes []int) proposal {
	q := r.proposals[p]
	q.fixes = nil
	for _, f := range fixes {
		q.fixes = append(q.fixes, r.proposals[p].fixes[f])
	}
	return q
}

// trial checks the program of the kept fixes and parts: all of it, or only
// files when it names some.
func (r *gateRound) trial(parts []part, files []tspath.RootedFilePath) checked {
	fixes := map[int][]int{}
	for p, fs := range r.kept {
		fixes[p] = slices.Clone(fs)
	}
	for _, pt := range parts {
		fixes[pt.p] = append(fixes[pt.p], pt.fixes...)
	}
	overlay := map[tspath.RootedFilePath]string{}
	for p, fs := range fixes {
		slices.Sort(fs)
		overlay[r.proposals[p].file.FileName()] = r.subset(p, fs).text()
	}
	program := r.g.build(maps(r.texts, overlay))
	var errors []*ast.Diagnostic
	if files == nil {
		errors = programErrors(r.g.ctx, program)
	} else {
		for _, name := range files {
			if file := program.GetSourceFile(name); file != nil {
				for _, d := range slices.Concat(program.GetSyntacticDiagnostics(r.g.ctx, file), program.GetSemanticDiagnostics(r.g.ctx, file)) {
					if d.Category() == diagnostics.CategoryError {
						errors = append(errors, d)
					}
				}
			}
		}
	}
	counts := map[string]int{}
	for _, d := range errors {
		counts[errorKey(d)]++
	}
	added := map[string]int{}
	for key, n := range counts {
		if n > r.g.baseline[key] {
			added[key] = n - r.g.baseline[key]
		}
	}
	if files == nil && len(added) > 0 {
		r.g.lastFailed = program
		if len(r.kept) == 0 && len(parts) == 1 && len(parts[0].fixes) == 1 {
			if r.g.alone == nil {
				r.g.alone = map[[32]byte]map[string]int{}
			}
			r.g.alone[r.aloneKey(parts[0].p, parts[0].fixes)] = added
		}
	}
	return checked{program, fixes, errors, added}
}

// aloneKey names the program of the texts of the round with fixes of
// proposal p alone applied.
func (r *gateRound) aloneKey(p int, fixes []int) [32]byte {
	if r.textsKey == nil {
		names := make([]tspath.RootedFilePath, 0, len(r.texts))
		for name := range r.texts {
			names = append(names, name)
		}
		slices.SortFunc(names, tspath.RootedFilePath.Compare)
		hash := sha256.New()
		for _, name := range names {
			fmt.Fprintf(hash, "%q%q", name.AsString(), r.texts[name])
		}
		r.textsKey = hash.Sum(nil)
	}
	hash := sha256.New()
	fmt.Fprintf(hash, "%q%q%q", r.textsKey, r.proposals[p].file.FileName().AsString(), r.subset(p, fixes).text())
	var key [32]byte
	copy(key[:], hash.Sum(nil))
	return key
}

// keep keeps parts, whose trial with the kept fixes adds no error, and
// hands the texts of the kept fixes to fixGate.verified.
func (r *gateRound) keep(parts ...part) {
	for _, pt := range parts {
		r.kept[pt.p] = append(r.kept[pt.p], pt.fixes...)
		slices.Sort(r.kept[pt.p])
	}
	if r.g.verified != nil {
		overlay := map[tspath.RootedFilePath]string{}
		for p, fixes := range r.kept {
			overlay[r.proposals[p].file.FileName()] = r.subset(p, fixes).text()
		}
		r.g.verified(maps(r.texts, overlay))
	}
}

func (r *gateRound) refuse(at [2]int, added map[string]int) {
	first := ""
	for key := range added {
		if first == "" || key < first {
			first = key
		}
	}
	r.refusals = append(r.refusals, gateRefusal{at, first})
}

// reportsAny reports whether one of the keys of added is an error of name.
func reportsAny(added map[string]int, name tspath.RootedFilePath) bool {
	prefix := name.AsString() + ": " // errorKey's
	for key := range added {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

// split divides parts into the fixes in named and the others.
func split(parts []part, named func([2]int) bool) (in, out []part) {
	for _, pt := range parts {
		var yes, no []int
		for _, f := range pt.fixes {
			if named([2]int{pt.p, f}) {
				yes = append(yes, f)
			} else {
				no = append(no, f)
			}
		}
		if len(yes) > 0 {
			in = append(in, part{pt.p, yes})
		}
		if len(no) > 0 {
			out = append(out, part{pt.p, no})
		}
	}
	return in, out
}

// peel keeps the fixes of parts that add no error to the kept ones, and
// refuses the others; t is their trial, which adds errors. It sets aside
// the fixes whose own text holds an error t adds, and peels the rest the
// same way until it passes; then it peels the fixes set aside on top of
// it. When each fix left holds the errors its trial adds, as many as it
// adds, each is refused, named by the first. When no fix's text holds one,
// the fix that an added error traces to (culprit) is refused, and when none
// does, parts are halved.
func (r *gateRound) peel(parts []part, t checked) {
	for len(t.added) > 0 && r.g.done.Err() == nil {
		if len(parts) == 1 && len(parts[0].fixes) == 1 {
			// t is the trial of this fix with the kept ones.
			r.refuse([2]int{parts[0].p, parts[0].fixes[0]}, t.added)
			return
		}
		inParts := map[[2]int]bool{}
		for _, pt := range parts {
			for _, f := range pt.fixes {
				inParts[[2]int{pt.p, f}] = true
			}
		}
		held, unexplained := r.held(t, inParts)
		if len(held) == 0 {
			at, added, ok := r.culprit(parts, t)
			if !ok {
				r.halve(parts, &t)
				return
			}
			r.refuse(at, added)
			_, parts = split(parts, func(h [2]int) bool { return h == at })
			if len(parts) == 0 {
				return
			}
			t = r.trial(parts, nil)
			continue
		}
		out, rest := split(parts, func(h [2]int) bool { return held[h] != nil })
		if len(rest) == 0 {
			if len(unexplained) > 0 {
				r.halve(parts, &t)
				return
			}
			for _, pt := range parts {
				for _, f := range pt.fixes {
					added := map[string]int{}
					for _, key := range held[[2]int{pt.p, f}] {
						added[key]++
					}
					r.refuse([2]int{pt.p, f}, added)
				}
			}
			return
		}
		if tr := r.trial(rest, nil); len(tr.added) > 0 {
			r.peel(rest, tr)
		} else {
			r.keep(rest...)
		}
		parts, t = out, r.trial(out, nil)
	}
	if r.g.done.Err() == nil {
		r.keep(parts...)
	}
}

// held returns the added errors of t that lie in the text a fix of named
// wrote, by fix, and the number of the others by key. An error in the text
// of two fixes, or of a key with fewer added than lie in fixes' text, is
// one of the others.
func (r *gateRound) held(t checked, named map[[2]int]bool) (map[[2]int][]string, map[string]int) {
	spans := r.spans(t)
	byKey := map[string][]*ast.Diagnostic{}
	for _, d := range t.errors {
		if key := errorKey(d); t.added[key] > 0 {
			byKey[key] = append(byKey[key], d)
		}
	}
	held := map[[2]int][]string{}
	unexplained := map[string]int{}
	for key, ds := range byKey {
		var holders [][2]int
		ambiguous := false
		for _, d := range ds {
			if d.File() == nil {
				continue
			}
			in := spans.holding(d.File().FileName(), d.Pos(), d.End())
			ambiguous = ambiguous || len(in) > 1
			holders = append(holders, in...)
		}
		n := t.added[key]
		if ambiguous || len(holders) > n || slices.ContainsFunc(holders, func(h [2]int) bool { return !named[h] }) {
			unexplained[key] = n
			continue
		}
		for _, h := range holders {
			held[h] = append(held[h], key)
		}
		if len(holders) < n {
			unexplained[key] = n - len(holders)
		}
	}
	return held, unexplained
}

// culprit finds the fix of parts that brings an error t adds outside every
// fix's text: of the fixes whose text holds a declaration such an error
// reads (blameReads), in the order it reaches them, the first whose
// addition to the other fixes of parts brings one back. It checks only the
// files that report those errors, adding the fixes it reaches in steps that
// double, then halving the last step. It returns the errors of those files
// the fix brings back.
func (r *gateRound) culprit(parts []part, t checked) ([2]int, map[string]int, bool) {
	everyFix := map[[2]int]bool{}
	for p, fixes := range t.fixes {
		for _, f := range fixes {
			everyFix[[2]int{p, f}] = true
		}
	}
	_, unexplained := r.held(t, everyFix)
	var files []tspath.RootedFilePath
	for _, d := range t.errors {
		if d.File() != nil && unexplained[errorKey(d)] > 0 && !slices.Contains(files, d.File().FileName()) {
			files = append(files, d.File().FileName())
		}
	}
	inParts := map[[2]int]bool{}
	for _, pt := range parts {
		for _, f := range pt.fixes {
			inParts[[2]int{pt.p, f}] = true
		}
	}
	var reached [][2]int
	for _, h := range blameReads(r.g.ctx, t.program, t.errors, unexplained, r.spans(t)) {
		if inParts[h] {
			reached = append(reached, h)
		}
	}
	if len(reached) == 0 || len(files) == 0 {
		return [2]int{}, nil, false
	}
	_, base := split(parts, func(h [2]int) bool { return slices.Contains(reached, h) })
	with := func(n int) []part {
		ps := slices.Clone(base)
		for _, h := range reached[:n] {
			ps = append(ps, part{h[0], []int{h[1]}})
		}
		return ps
	}
	brings := func(c checked) bool {
		for key := range unexplained {
			if c.added[key] > 0 {
				return true
			}
		}
		return false
	}
	low := checked{added: map[string]int{}} // the kept fixes pass
	if len(base) > 0 {
		if low = r.trial(with(0), files); brings(low) {
			return [2]int{}, nil, false
		}
	}
	// The fixes it reaches first are the likeliest: try 1, 2, 4, … of
	// them, then halve the last step.
	lo, hi := 0, 0
	var high checked
	for step := 1; r.g.done.Err() == nil; step *= 2 {
		hi = min(lo+step, len(reached))
		c := r.trial(with(hi), files)
		if brings(c) {
			high = c
			break
		}
		if hi == len(reached) {
			return [2]int{}, nil, false
		}
		lo, low = hi, c
	}
	for hi-lo > 1 && r.g.done.Err() == nil {
		mid := (lo + hi) / 2
		if c := r.trial(with(mid), files); brings(c) {
			hi, high = mid, c
		} else {
			lo, low = mid, c
		}
	}
	if r.g.done.Err() != nil || hi == 0 {
		// Interrupted before it found the fix: a stopped run keeps what
		// was kept before (fixKeeper).
		return [2]int{}, nil, false
	}
	added := map[string]int{}
	for key, n := range high.added {
		if n > low.added[key] {
			added[key] = n - low.added[key]
		}
	}
	return reached[hi-1], added, len(added) > 0
}

// fixSpanSet is where the fixes of a trial wrote, by file.
type fixSpanSet map[tspath.RootedFilePath][]fixSpan

type fixSpan struct {
	at  [2]int
	pos int
	end int
}

// spans returns where the fixes of t wrote in its program's text.
func (r *gateRound) spans(t checked) fixSpanSet {
	set := fixSpanSet{}
	for p, fixes := range t.fixes {
		name := r.proposals[p].file.FileName()
		for j, ranges := range r.subset(p, fixes).fixSpans() {
			for _, rg := range ranges {
				set[name] = append(set[name], fixSpan{[2]int{p, fixes[j]}, rg.Pos(), rg.End()})
			}
		}
	}
	return set
}

// holding returns the fixes whose text overlaps pos to end of name.
func (s fixSpanSet) holding(name tspath.RootedFilePath, pos, end int) [][2]int {
	var in [][2]int
	for _, span := range s[name] {
		if span.pos <= end && pos <= span.end && !slices.Contains(in, span.at) {
			in = append(in, span.at)
		}
	}
	return in
}

// halve keeps the fixes of parts that, with the kept ones, add no error,
// and refuses each that adds one, as fixGate.accept did before it peeled,
// ordered by the files an importer's errors trace to (errorSources):
// known is the trial of parts, which adds an error. A set of parts that
// adds an error is halved until each half passes or is one file, the
// files that report none of the errors first, and each failing file's
// fixes are halved the same way.
func (r *gateRound) halve(parts []part, known *checked) {
	// The files whose edited declarations the errors of an importer read
	// (fixGate.errorSources) are the likeliest; they only order the halving.
	sources := func(ps []part) map[tspath.RootedFilePath]bool {
		proposals := make([]proposal, len(ps))
		for i, pt := range ps {
			proposals[i] = r.subset(pt.p, pt.fixes)
		}
		return r.g.errorSources(proposals)
	}
	r.g.lastFailed = known.program
	origins := sources(parts)
	var others, suspects []part
	for _, pt := range parts {
		name := r.proposals[pt.p].file.FileName()
		if origins[name] || len(origins) == 0 && reportsAny(known.added, name) {
			suspects = append(suspects, pt)
		} else {
			others = append(others, pt)
		}
	}
	var failing []part
	var files func([]part, bool)
	files = func(ps []part, known bool) { // known: ps together add an error
		if r.g.done.Err() != nil {
			return
		}
		if !known && len(r.trial(ps, nil).added) == 0 {
			r.keep(ps...)
			return
		}
		if len(ps) == 1 {
			failing = append(failing, ps[0])
			return
		}
		likely := sources(ps)
		rest, named := split(ps, func(h [2]int) bool { return !likely[r.proposals[h[0]].file.FileName()] })
		if len(named) > 0 && len(rest) > 0 {
			files(rest, false)
			files(named, false)
			return
		}
		files(ps[:len(ps)/2], false)
		files(ps[len(ps)/2:], false)
	}
	if len(others) == 0 || len(suspects) == 0 {
		files(parts, true)
	} else {
		files(others, false)
		files(suspects, false)
	}
	for _, pt := range failing {
		var fixes func([]int, bool)
		fixes = func(fs []int, known bool) { // known: the kept fixes and fs add an error
			if r.g.done.Err() != nil {
				return
			}
			if !known || len(fs) == 1 {
				t := r.trial([]part{{pt.p, fs}}, nil)
				if len(t.added) == 0 {
					r.keep(part{pt.p, fs})
					return
				}
				if len(fs) == 1 {
					r.refuse([2]int{pt.p, fs[0]}, t.added)
					return
				}
			}
			fixes(fs[:len(fs)/2], false)
			fixes(fs[len(fs)/2:], false)
		}
		fixes(pt.fixes, true)
	}
}

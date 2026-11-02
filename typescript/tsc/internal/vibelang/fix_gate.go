package vibelang

import (
	"context"
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
// is traced to the fix it reads a declaration of (gateRound.culprits). A fix
// an earlier round refused on its own is refused again without a check
// when this round offers it to the same texts (fixGate.alone). A round so
// costs a few checks of the program, however many fixes it refuses, where
// halving it cost two or more for each. Once a trial has added errors, the
// next looks for its own in the files that reported them (gateRound.trial):
// an error there that the round's own texts do not report when only those
// files are checked proves it fails, and only a trial clean there goes on
// to the whole program. A halving writes the fixes it has verified as it
// goes (gateRound.checkpoint), and a round that has checked
// fixIsolationChecks programs refuses the fixes it has not told apart.
func (g *fixGate) accept(texts map[tspath.RootedFilePath]string, proposals []proposal, refuse func(FixRefusal, string)) []proposal {
	r := &gateRound{g: g, texts: texts, proposals: proposals, kept: map[int][]int{}, nextCheckpoint: g.checkpointFirstAt()}
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
	r.refuseUntold()
	return r.finish(class, refuse)
}

// acceptEach is accept as D291 words it, with a check for each fix: in
// order, each fix is kept when it adds no error to the fixes kept before
// it, and refused otherwise. It is the oracle accept is fuzzed against
// (FixOptions.CheckEachFix).
func (g *fixGate) acceptEach(texts map[tspath.RootedFilePath]string, proposals []proposal, refuse func(FixRefusal, string)) []proposal {
	r := &gateRound{g: g, texts: texts, proposals: proposals, kept: map[int][]int{}, wholeOnly: true}
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
		refuse(FixRefusal{File: p.file.FileName(), Line: line + 1, Code: fix.code, Label: fix.label, Error: refusal.error}, fix.key)
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
// refused, by proposal and fix index, the fixes halving has kept until a
// check of the whole program verifies them, and the files that reported an
// error a trial added, in the order they did.
type gateRound struct {
	g         *fixGate
	texts     map[tspath.RootedFilePath]string
	proposals []proposal
	kept      map[int][]int
	tentative []part
	reporting []tspath.RootedFilePath
	wholeOnly bool // every trial checks the whole program
	refusals  []gateRefusal
	textsKey  []byte
	// The programs the round has checked, the errors its texts report in
	// each list of files checked alone (orderErrors), when it next checks
	// the halving's fixes to write them and how many programs it has
	// checked to (checkpoint), the fixes it stopped before telling apart
	// (untold), and the first error its first trial added.
	firstError       string
	checks           int
	orders           map[string]map[string]int
	nextCheckpoint   int
	checkpointChecks int
	untold           []part
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
// fixes it applies by proposal, its errors, the errors it adds by key and
// number, and whether it checked the whole program. A trial of some files
// counts only their errors.
type checked struct {
	program *compiler.Program
	fixes   map[int][]int
	errors  []*ast.Diagnostic
	added   map[string]int
	whole   bool
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

// trial checks the program of the kept fixes and parts in files, when it
// names some. Otherwise it checks the files of the round that reported an
// error first and, when they add none, all of the program: an error those
// files report beyond the round's own texts checked the same way
// (orderErrors) proves a trial fails and only the whole program proves one
// passes, and on a 240-module slice of t3code's apps/server a check of
// those files took 10 to 20 s, and one of the program 6 minutes
// (2026-11-01). A fix refused on that evidence is named by the first error
// of those files.
func (r *gateRound) trial(parts []part, files []tspath.RootedFilePath) checked {
	fixes := map[int][]int{}
	for p, fs := range r.kept {
		fixes[p] = slices.Clone(fs)
	}
	for _, pt := range slices.Concat(r.tentative, parts) {
		fixes[pt.p] = append(fixes[pt.p], pt.fixes...)
	}
	overlay := map[tspath.RootedFilePath]string{}
	for p, fs := range fixes {
		slices.Sort(fs)
		overlay[r.proposals[p].file.FileName()] = r.subset(p, fs).text()
	}
	size := 0
	for _, fs := range fixes {
		size += len(fs)
	}
	r.g.progress.checkFixes(size, len(overlay))
	first := files
	if files == nil {
		first = r.likelyFiles(parts)
	}
	if first != nil {
		r.g.progress.partial()
	}
	r.checks++
	program := r.g.build(maps(r.texts, overlay))
	r.g.progress.label("")
	var errors []*ast.Diagnostic
	if first != nil {
		errors = fileErrors(r.g.ctx, program, first)
	}
	added := r.addedBy(errors)
	if first != nil && len(added) > 0 {
		added = r.beyondOrder(added, first)
	}
	whole := first == nil
	if files == nil && first != nil && len(added) == 0 {
		// The whole program, in a program no check has read: one checked
		// in some files first can report an error a check of the whole
		// program does not (orderErrors). On opencode's core, the 410 fixes
		// a halving had kept so far added none to a new program, and the
		// errors of session.vibe's circular annotation to the program
		// checked in the 87 files first (2026-11-02).
		fresh := r.g.fresh
		if fresh == nil {
			fresh = r.g.build
		}
		r.g.progress.checkFixes(size, len(overlay))
		r.checks++
		program = fresh(maps(r.texts, overlay))
		r.g.progress.label("")
		whole = true
	}
	if whole {
		errors = programErrors(r.g.ctx, program)
		added = r.addedBy(errors)
	}
	if r.firstError == "" {
		for key := range added {
			if r.firstError == "" || key < r.firstError {
				r.firstError = key
			}
		}
	}
	for _, d := range errors {
		if d.File() != nil && added[errorKey(d)] > 0 && !slices.Contains(r.reporting, d.File().FileName()) {
			r.reporting = append(r.reporting, d.File().FileName())
		}
	}
	if files == nil && len(added) > 0 {
		if whole {
			r.g.lastFailed = program
		}
		if len(r.kept) == 0 && len(parts) == 1 && len(parts[0].fixes) == 1 {
			if r.g.alone == nil {
				r.g.alone = map[[32]byte]map[string]int{}
			}
			r.g.alone[r.aloneKey(parts[0].p, parts[0].fixes)] = added
		}
	}
	return checked{program, fixes, errors, added, whole}
}

// likelyFiles returns the files likeliest to report an error parts add:
// those of the round's added errors and, for one proposal, its own. It
// returns nil before any trial has added an error.
func (r *gateRound) likelyFiles(parts []part) []tspath.RootedFilePath {
	if r.wholeOnly || len(r.reporting) == 0 {
		return nil
	}
	files := slices.Clone(r.reporting)
	if len(parts) == 1 {
		if own := r.proposals[parts[0].p].file.FileName(); !slices.Contains(files, own) {
			files = append(files, own)
		}
	}
	return files
}

// addedBy returns the errors of errors that the baseline does not hold,
// by key and number.
func (r *gateRound) addedBy(errors []*ast.Diagnostic) map[string]int {
	return addedCounts(errors, r.g.baseline)
}

// beyondOrder returns added, the errors a check of only files adds, without
// those the round's own texts report when only files are checked
// (orderErrors).
func (r *gateRound) beyondOrder(added map[string]int, files []tspath.RootedFilePath) map[string]int {
	order := r.orderErrors(files)
	if len(order) == 0 {
		return added
	}
	rest := map[string]int{}
	for key, n := range added {
		if n -= order[key]; n > 0 {
			rest[key] = n
		}
	}
	return rest
}

// orderErrors returns the errors, by key and number, that the round's own
// texts report beyond the baseline when only files are checked, in their
// order. A check of some files is not a check of the program: what the
// checker read first can decide whether a declaration reports an error.
// In opencode's core, session.vibe's "Return type annotation circularly
// references itself" (TS2577) came in every check of the 87 files that had
// reported an error, whatever its fixes, and the program reported it in
// none: each trial of the round's halving failed on it, and the gate tried
// 730 fixes one by one for an hour and wrote no file (opencode-60,
// 2026-11-02). The texts are checked in a program no other check has read,
// once for each list of files.
func (r *gateRound) orderErrors(files []tspath.RootedFilePath) map[string]int {
	var key strings.Builder
	for _, name := range files {
		key.WriteString(name.AsString())
		key.WriteByte(0)
	}
	if order, ok := r.orders[key.String()]; ok {
		return order
	}
	fresh := r.g.fresh
	if fresh == nil {
		fresh = r.g.build
	}
	r.g.progress.checkFixes(0, len(files))
	r.g.progress.partial()
	r.checks++
	program := fresh(maps(r.texts, nil))
	r.g.progress.label("")
	order := r.addedBy(fileErrors(r.g.ctx, program, files))
	if r.orders == nil {
		r.orders = map[string]map[string]int{}
	}
	r.orders[key.String()] = order
	return order
}

// fixIsolationChecks bounds the programs a round of the gate checks to
// tell apart the fixes that add errors (exhausted). A round that reaches
// it refuses the fixes it has not yet told apart, together and without
// another check (refuseUntold), and keeps the others it has verified.
// Below it, the bound changes nothing. On opencode's core a check took 10
// to 20 s, so 256 is about an hour (opencode-60, 2026-11-02).
var fixIsolationChecks = 256

// isolationBound is the gate's bound on a round's checks: its
// isolationChecks, or fixIsolationChecks when that is 0.
func (g *fixGate) isolationBound() int {
	if g.isolationChecks > 0 {
		return g.isolationChecks
	}
	return fixIsolationChecks
}

// checkpointFirstAt is the round's checks before its first checkpoint:
// the gate's checkpointFirst, or fixCheckpointFirst when that is 0.
func (g *fixGate) checkpointFirstAt() int {
	if g.checkpointFirst > 0 {
		return g.checkpointFirst
	}
	return fixCheckpointFirst
}

// exhausted reports whether the round has checked fixIsolationChecks
// programs.
func (r *gateRound) exhausted() bool {
	return r.checks >= r.g.isolationBound()
}

// refuseUntold refuses the fixes the round stopped before telling apart,
// named by the first error the round's first trial added, which they were
// all part of, and why no check tried them alone.
func (r *gateRound) refuseUntold() {
	n := 0
	for _, pt := range r.untold {
		n += len(pt.fixes)
	}
	if n == 0 {
		return
	}
	named := fmt.Sprintf("%s, one of the errors of %d %s the gate stopped telling apart after %d checks of its round; run vibelang --fix again to try them", r.firstError, n, plural(n, "fix", "fixes"), r.g.isolationBound())
	for _, pt := range r.untold {
		for _, f := range pt.fixes {
			r.refusals = append(r.refusals, gateRefusal{[2]int{pt.p, f}, named})
		}
	}
	r.g.progress.decided(0, n)
	r.untold = nil
}

// fixCheckpointFirst is the round's checks before a halving first checks
// its fixes to write them (checkpoint), and fixCheckpointChecks the checks
// of the whole program a round's checkpoints make at most.
var fixCheckpointFirst, fixCheckpointChecks = 16, 4

// checkpoint hands the kept fixes and the halving's tentative ones to
// fixGate.verified once a check of the whole program verifies them, so a
// stopped run keeps them (fixKeeper). It decides nothing: the halving goes
// on as it would, and its last check verifies what it keeps. A halving
// checks only the files that report errors, and it kept nothing before its
// last check: on opencode's core a round halved for an hour, and the
// stopped run wrote no file (opencode-60, 2026-11-02). It checks once the
// round has checked 16 programs, then 32, 64 and so on, so its checks grow
// with the log of the round's. When the program adds an error, it sets
// aside the tentative fixes of the files that report one and of the files
// they import, and checks the rest again, fixCheckpointChecks times a round
// at most. Each check is of a program no trial has read: a program checked
// in some files first can report an error a check of the whole program
// does not (orderErrors).
func (r *gateRound) checkpoint() {
	if r.g.verified == nil || r.wholeOnly || r.checks < r.nextCheckpoint {
		return
	}
	r.nextCheckpoint *= 2
	fresh := r.g.fresh
	if fresh == nil {
		fresh = r.g.build
	}
	parts := slices.Clone(r.tentative)
	for len(parts) > 0 && r.checkpointChecks < fixCheckpointChecks {
		r.checkpointChecks++
		fixes := map[int][]int{}
		for p, fs := range r.kept {
			fixes[p] = slices.Clone(fs)
		}
		for _, pt := range parts {
			fixes[pt.p] = append(fixes[pt.p], pt.fixes...)
		}
		overlay := map[tspath.RootedFilePath]string{}
		size := 0
		for p, fs := range fixes {
			slices.Sort(fs)
			overlay[r.proposals[p].file.FileName()] = r.subset(p, fs).text()
			size += len(fs)
		}
		r.g.progress.checkFixes(size, len(overlay))
		r.checks++
		program := fresh(maps(r.texts, overlay))
		r.g.progress.label("")
		errors := programErrors(r.g.ctx, program)
		added := r.addedBy(errors)
		if len(added) == 0 {
			r.g.verified(maps(r.texts, overlay))
			return
		}
		aside := map[tspath.RootedFilePath]bool{}
		for _, d := range errors {
			if d.File() == nil || added[errorKey(d)] == 0 || aside[d.File().FileName()] {
				continue
			}
			aside[d.File().FileName()] = true
			for _, m := range program.GetResolvedModules()[d.File().PathKey()] {
				if m != nil && m.IsResolved() {
					if target := program.GetSourceFileForResolvedModule(m); target != nil {
						aside[target.FileName()] = true
					}
				}
			}
		}
		rest := slices.DeleteFunc(slices.Clone(parts), func(pt part) bool { return aside[r.proposals[pt.p].file.FileName()] })
		if len(rest) == len(parts) {
			return // no error names a file of the fixes
		}
		parts = rest
	}
}

// fileErrors returns the errors of files in program.
func fileErrors(ctx context.Context, program *compiler.Program, files []tspath.RootedFilePath) []*ast.Diagnostic {
	var errors []*ast.Diagnostic
	for _, name := range files {
		if file := program.GetSourceFile(name); file != nil {
			for _, d := range slices.Concat(program.GetSyntacticDiagnostics(ctx, file), program.GetSemanticDiagnostics(ctx, file)) {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, d)
				}
			}
		}
	}
	return errors
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
		r.g.progress.decided(len(pt.fixes), 0)
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
	r.g.progress.decided(0, 1)
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
// the fixes that the added errors trace to (culprits) are refused, found
// again in the files that report the errors until those report none, and
// when none does, parts are halved.
func (r *gateRound) peel(parts []part, t checked) {
	for len(t.added) > 0 && r.g.done.Err() == nil {
		if r.exhausted() {
			r.untold = append(r.untold, parts...)
			return
		}
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
			found := r.culprits(parts, t)
			if len(found) == 0 {
				r.halve(parts, &t)
				return
			}
			// The files that report the errors are checked again without
			// the culprits, and searched again while they report one, before
			// the whole program is: on a 240-module slice of t3code's
			// apps/server a check of them took 10 to 20 s, and one of the
			// program 6 minutes (2026-11-01).
			var files []tspath.RootedFilePath
			for _, d := range t.errors {
				if d.File() != nil && unexplained[errorKey(d)] > 0 && !slices.Contains(files, d.File().FileName()) {
					files = append(files, d.File().FileName())
				}
			}
			for len(found) > 0 && r.g.done.Err() == nil && !r.exhausted() {
				refused := map[[2]int]bool{}
				for _, c := range found {
					r.refuse(c.at, c.added)
					refused[c.at] = true
				}
				_, parts = split(parts, func(h [2]int) bool { return refused[h] })
				if len(parts) == 0 {
					return
				}
				again := r.trial(parts, files)
				if len(again.added) == 0 {
					break
				}
				if held, _ := r.held(again, everyFixOf(parts)); len(held) > 0 {
					break // the whole program's trial sets them aside
				}
				found = r.culprits(parts, again)
			}
			if r.g.done.Err() != nil {
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

// everyFixOf returns the fixes of parts.
func everyFixOf(parts []part) map[[2]int]bool {
	fixes := map[[2]int]bool{}
	for _, pt := range parts {
		for _, f := range pt.fixes {
			fixes[[2]int{pt.p, f}] = true
		}
	}
	return fixes
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

// culprits finds the fixes of parts that bring the errors t adds outside
// every fix's text. The errors of each file are a group: the fixes whose
// text holds a declaration they read (blameReads), in the order it reaches
// them, and the first whose addition to the other fixes of parts brings one
// back is the group's culprit. The groups whose fixes and files touch no
// other group's are searched together: each trial adds, for each group,
// the fixes it reaches in steps that double, then halves the last step,
// and checks only the files of the groups. A round with many fixes that
// add errors to other files so costs a few checks, where finding one
// culprit at a time cost a check of the whole program each, and the
// refusals and the cost of a check both grow with the project: 24 such
// fixes in 240 modules took 27 whole checks (TestFixScalesWithTheProject).
// A group that touches another is left to the next search. When there
// are not two groups, or they find no culprit, the fixes the errors of
// every file reach are searched as one group, with the files of every
// error. It returns, by culprit, the errors of its group's files the fix
// brings back.
func (r *gateRound) culprits(parts []part, t checked) []gateCulprit {
	if r.exhausted() {
		return nil
	}
	everyFix := map[[2]int]bool{}
	for p, fixes := range t.fixes {
		for _, f := range fixes {
			everyFix[[2]int{p, f}] = true
		}
	}
	_, unexplained := r.held(t, everyFix)
	inParts := map[[2]int]bool{}
	for _, pt := range parts {
		for _, f := range pt.fixes {
			inParts[[2]int{pt.p, f}] = true
		}
	}
	// The errors of each file, in the order t reports them.
	var order []tspath.RootedFilePath
	byFile := map[tspath.RootedFilePath][]*ast.Diagnostic{}
	for _, d := range t.errors {
		if d.File() == nil || unexplained[errorKey(d)] == 0 {
			continue
		}
		name := d.File().FileName()
		if byFile[name] == nil {
			order = append(order, name)
		}
		byFile[name] = append(byFile[name], d)
	}
	spans := r.spans(t)
	budget := newBlameBudget() // the groups' walks share one search's
	var groups []*culpritGroup
	taken := map[[2]int]bool{}                  // the fixes of the groups
	touched := map[tspath.RootedFilePath]bool{} // their files and the files of their fixes
	for _, name := range order {
		if len(groups) == culpritGroupLimit {
			break
		}
		g := &culpritGroup{files: []tspath.RootedFilePath{name}, keys: map[string]bool{}, step: 1}
		for _, d := range byFile[name] {
			g.keys[errorKey(d)] = true
		}
		// A file walks a few of its errors, so that one with many leaves
		// the budget to the others.
		share := &blameBudget{errors: min(budget.errors, 4), names: min(budget.names, 2500)}
		walk := *share
		for _, h := range blameReads(r.g.ctx, t.program, byFile[name], unexplained, spans, share) {
			if inParts[h] {
				g.reached = append(g.reached, h)
			}
		}
		budget.errors -= walk.errors - share.errors
		budget.names -= walk.names - share.names
		independent := len(g.reached) > 0 && !touched[name]
		for _, h := range g.reached {
			independent = independent && !taken[h] && !touched[r.proposals[h[0]].file.FileName()]
		}
		if !independent {
			continue // searched once this search's culprits are refused
		}
		touched[name] = true
		for _, h := range g.reached {
			taken[h] = true
			touched[r.proposals[h[0]].file.FileName()] = true
		}
		groups = append(groups, g)
	}
	if len(groups) > 1 {
		if found := r.search(parts, groups); len(found) > 0 || r.g.done.Err() != nil {
			return found
		}
	}
	// One search: the fixes the errors of every file reach, checked with
	// the files of every error.
	g := &culpritGroup{files: order, keys: map[string]bool{}, step: 1}
	for key := range unexplained {
		g.keys[key] = true
	}
	for _, h := range blameReads(r.g.ctx, t.program, t.errors, unexplained, spans, newBlameBudget()) {
		if inParts[h] {
			g.reached = append(g.reached, h)
		}
	}
	if len(g.reached) == 0 || len(order) == 0 {
		return nil
	}
	return r.search(parts, []*culpritGroup{g})
}

// search finds the culprit of each of groups, whose fixes are of parts and
// touch no other group's files or fixes, in trials that check only the
// groups' files.
func (r *gateRound) search(parts []part, groups []*culpritGroup) []gateCulprit {
	taken := map[[2]int]bool{}
	for _, g := range groups {
		for _, h := range g.reached {
			taken[h] = true
		}
	}
	_, base := split(parts, func(h [2]int) bool { return taken[h] })
	var files []tspath.RootedFilePath
	for _, g := range groups {
		files = append(files, g.files...)
	}
	// trial checks base with the first n fixes each group reaches.
	trial := func(n func(*culpritGroup) int) checked {
		ps := slices.Clone(base)
		for _, g := range groups {
			for _, h := range g.reached[:n(g)] {
				ps = append(ps, part{h[0], []int{h[1]}})
			}
		}
		return r.trial(ps, files)
	}
	if len(base) > 0 {
		low := trial(func(*culpritGroup) int { return 0 })
		for _, g := range groups {
			if g.low = g.of(low.added); g.brings(g.low) {
				g.failed = true // the kept fixes and the others bring it
			}
		}
	}
	for r.g.done.Err() == nil && !r.exhausted() {
		searching := false
		for _, g := range groups {
			searching = searching || g.searching()
		}
		if !searching {
			break
		}
		next := map[*culpritGroup]int{}
		for _, g := range groups {
			next[g] = g.next()
		}
		c := trial(func(g *culpritGroup) int { return next[g] })
		for _, g := range groups {
			if g.searching() {
				g.observe(next[g], c.added)
			}
		}
	}
	if r.g.done.Err() != nil || r.exhausted() {
		// Interrupted before it found them: a stopped run keeps what was
		// kept before (fixKeeper), and a round out of checks refuses the
		// fixes it has not told apart (refuseUntold).
		return nil
	}
	var found []gateCulprit
	for _, g := range groups {
		if g.failed || g.hi == 0 {
			continue
		}
		added := map[string]int{}
		for key, n := range g.high {
			if n > g.low[key] {
				added[key] = n - g.low[key]
			}
		}
		if len(added) > 0 {
			found = append(found, gateCulprit{g.reached[g.hi-1], added})
		}
	}
	return found
}

// culpritGroupLimit bounds the groups one search of culprits holds.
const culpritGroupLimit = 64

// A gateCulprit is a fix that brings errors to other files, and the errors.
type gateCulprit struct {
	at    [2]int
	added map[string]int
}

// A culpritGroup is the search for the fix that brings the errors of
// files: of the fixes reached, the first lo bring none of them, and the
// first hi, once found, bring one, with the errors of the files each
// adds.
type culpritGroup struct {
	files     []tspath.RootedFilePath
	keys      map[string]bool // the errors of files t adds outside every fix's text
	reached   [][2]int
	lo, hi    int
	step      int
	halving   bool
	failed    bool
	low, high map[string]int
}

func (g *culpritGroup) searching() bool {
	return !g.failed && !(g.halving && g.hi-g.lo <= 1)
}

// next is the number of reached fixes the next trial adds: the next step
// that doubles, then the middle of the last.
func (g *culpritGroup) next() int {
	if !g.searching() {
		if g.halving {
			return g.lo
		}
		return 0
	}
	if g.halving {
		return (g.lo + g.hi) / 2
	}
	return min(g.lo+g.step, len(g.reached))
}

// observe takes the errors a trial of the first n reached fixes adds.
func (g *culpritGroup) observe(n int, added map[string]int) {
	mine := g.of(added)
	switch {
	case g.halving && g.brings(mine):
		g.hi, g.high = n, mine
	case g.halving:
		g.lo, g.low = n, mine
	case g.brings(mine):
		g.hi, g.high, g.halving = n, mine, true
	case n == len(g.reached):
		g.failed = true
	default:
		g.lo, g.low = n, mine
		g.step *= 2
	}
}

// of returns the errors of added in the group's files.
func (g *culpritGroup) of(added map[string]int) map[string]int {
	mine := map[string]int{}
	for key, n := range added {
		for _, name := range g.files {
			if strings.HasPrefix(key, name.AsString()+": ") {
				mine[key] = n
				break
			}
		}
	}
	return mine
}

// brings reports whether added holds an error the group searches for.
func (g *culpritGroup) brings(added map[string]int) bool {
	for key := range g.keys {
		if added[key] > 0 {
			return true
		}
	}
	return false
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
//
// Its trials check the likely files only, and the fixes that pass them are
// tentative: a later trial reads them, and one check of the whole program
// at the end verifies them together, so that the check does not grow with
// the refusals. Nothing is kept before that check. When it adds an error
// the files it names join the likely ones and the tentative fixes are
// halved again. The files can only grow, and when it names none, each
// trial checks the whole program.
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
	if known.whole {
		r.g.lastFailed = known.program
	}
	// trial adds ps to the tentative fixes when they add no error there.
	trial := func(ps []part) checked {
		files := r.likelyFiles(ps)
		if files == nil && !r.wholeOnly {
			files = []tspath.RootedFilePath{} // no error names a file yet
		}
		t := r.trial(ps, files)
		if len(t.added) == 0 {
			r.tentative = append(r.tentative, ps...)
			r.checkpoint()
		}
		return t
	}
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
		if r.exhausted() {
			r.untold = append(r.untold, ps...)
			return
		}
		if !known && len(trial(ps).added) == 0 {
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
			if r.exhausted() {
				r.untold = append(r.untold, part{pt.p, fs})
				return
			}
			if !known || len(fs) == 1 {
				t := trial([]part{{pt.p, fs}})
				if len(t.added) == 0 {
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
	tentative := r.tentative
	if r.g.done.Err() != nil || len(tentative) == 0 {
		r.tentative = nil
		return
	}
	// The whole program, even when the last trial's files passed.
	before := len(r.reporting)
	r.tentative = nil
	t := r.trial(tentative, nil)
	if len(t.added) == 0 {
		r.keep(tentative...)
		return
	}
	if r.exhausted() {
		r.untold = append(r.untold, tentative...)
		return
	}
	if len(r.reporting) == before {
		r.wholeOnly = true
	}
	r.halve(tentative, &t)
}

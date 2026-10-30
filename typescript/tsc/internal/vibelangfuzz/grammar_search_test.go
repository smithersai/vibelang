package vibelangfuzz

import (
	"fmt"
	"hash/fnv"
	"math/rand"
	"os"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// A grammarLab is one copy of Appendix A, ready to search.
type grammarLab struct {
	a     *grammarAppendixData
	g     *grammarCfg // Appendix A over the subset
	ts    *grammarCfg // the subset alone: TypeScript
	prose *grammarProseSet
}

func grammarNewGrammarLab(text, file string) (*grammarLab, error) {
	a, err := grammarReadAppendix(text, file)
	if err != nil {
		return nil, err
	}
	g := grammarBuildGrammar(a)
	ps := grammarNewProseSet(a, g)
	ps.apply(g)
	ts := grammarBuildGrammar(&grammarAppendixData{file: "ts"})
	return &grammarLab{a: a, g: g, ts: ts, prose: ps}, nil
}

// A grammarReading is how one grammar parses one sentence.
type grammarReading struct {
	p          *grammarEarley
	count      int64
	trees      []*grammarPtree
	incomplete bool
}

func (l *grammarLab) read(g *grammarCfg, toks []grammarToken, mode grammarParseMode) grammarReading {
	var rules *grammarProseSet
	if mode.prose {
		rules = l.prose
	}
	p := g.parse(toks, mode, rules)
	c := p.count()
	r := grammarReading{p: p, count: c}
	if (mode.prose || mode.filters) && l.prose.hasFilters() && c > 0 {
		limit := min(c, 64)
		var kept []*grammarPtree
		for n := int64(0); n < limit; n++ {
			if t := p.tree(n); l.prose.keep(p, t) {
				kept = append(kept, t)
			}
		}
		r.count = int64(len(kept))
		r.incomplete = c > limit && len(kept) < 2
		r.trees = kept[:min(len(kept), 2)]
	} else {
		for n := int64(0); n < min(c, 2); n++ {
			r.trees = append(r.trees, p.tree(n))
		}
	}
	if p.cyclic && r.count > 0 {
		r.count = max(r.count, 2)
		if len(r.trees) == 1 {
			r.trees = append(r.trees, r.trees[0])
		}
	}
	return r
}

// flat renders a derivation for comparing readings: every one-child node is
// its child, and semicolons and empty statements are left out.
func (r grammarReading) flat(n int) string {
	return grammarFlatRender(r.p, r.trees[n])
}

func grammarFlatRender(p *grammarEarley, t *grammarPtree) string {
	if t.rule == -1 {
		if tok := p.toks[t.i]; tok.text != ";" {
			return tok.text
		}
		return ""
	}
	if p.g.base(t.nt) == "EmptyStatement" {
		return ""
	}
	var parts []string
	for _, k := range t.kids {
		if s := grammarFlatRender(p, k); s != "" {
			parts = append(parts, s)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	if p.g.helper[t.nt] || len(parts) == 1 {
		return strings.Join(parts, " ")
	}
	return p.g.base(t.nt) + "(" + strings.Join(parts, " ") + ")"
}

// A grammarFinding is a sentence the grammar reads wrongly.
type grammarFinding struct {
	Kind        string // see findingKinds
	Effect      bool
	Sentence    string
	At          string
	Productions []string
	Parts       string // the alternatives the readings take where they part
	Trees       []string
}

// grammarFindingKinds says what each kind of finding means.
var grammarFindingKinds = map[string]string{
	"ambiguous":       "two derivations under the productions and Appendix A's prose rules",
	"prose-disagrees": "the productions alone and the productions with the prose rules each give one derivation, and they differ",
	"prose-rejects":   "the productions give one derivation and the prose rules reject it",
	"ts-changed":      "a TypeScript sentence gets a VibeLang derivation that is not TypeScript's",
	"ts-rejected":     "a TypeScript sentence has no VibeLang derivation",
	"relex":           "written without spaces, the sentence lexes into other tokens and reads differently",
	"prose-line":      "a line break the productions ignore changes the reading under the prose rules",
	"example":         "a sentence of an Appendix A text block doesn't read as its line says",
	"budget":          "the filtered forest exceeds the witness materialization bound",
	"undefined":       "a production names a nonterminal neither Appendix A nor TypeScript defines",
}

// Key is the finding's precise key: its kind, the production where the
// readings part and the Appendix A productions involved.
func (f grammarFinding) Key() string {
	if f.Parts != "" {
		return f.Kind + ":" + f.At + ":" + f.Parts
	}
	return f.Kind + ":" + f.At + ":" + strings.Join(f.Productions, "+")
}

func (f grammarFinding) String() string {
	where := "outside effect code"
	if f.Effect {
		where = "in effect code"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s (%s): %s\n  sentence: %s\n  at %s, productions %s", f.Kind, where, grammarFindingKinds[f.Kind], strings.ReplaceAll(f.Sentence, "\n", " ⏎ "), f.At, strings.Join(f.Productions, ", "))
	for i, t := range f.Trees {
		fmt.Fprintf(&b, "\n  reading %d: %s", i+1, t)
	}
	return b.String()
}

// grammarPair describes where two derivations part.
func grammarPair(kind string, effect bool, toks []grammarToken, pa *grammarEarley, a *grammarPtree, pb *grammarEarley, b *grammarPtree) grammarFinding {
	f := grammarFinding{Kind: kind, Effect: effect, Sentence: grammarSpell(toks)}
	da, db := a, b
	if pa.g == pb.g {
		// The two parsers read the same tokens with the same grammar, so
		// one of them can compare both derivations.
		f.At, da, db = pa.diverge(a, b, "Script")
		// A split in a statement list or a TypeScript production is named
		// by the Appendix A production on either side of it.
		if grammarTsNames()[f.At] || f.At == "Script" {
			if n := grammarDifferingVibe(pa, da, db); n != "" {
				f.At = n
			}
		}
		x, y := pa.g.alt(da.rule), pa.g.alt(db.rule)
		switch {
		case x == y:
			f.Parts = "split:" + x
		case x < y:
			f.Parts = x + "|" + y
		default:
			f.Parts = y + "|" + x
		}
	} else {
		// A TypeScript derivation against a VibeLang one: name the first
		// Appendix A production the VibeLang reading uses.
		f.At = "Script"
		if name := pb.firstVibe(b); name != "" {
			f.At, f.Parts = name, name
		}
	}
	prods := map[string]bool{}
	pa.productions(da, prods)
	pb.productions(db, prods)
	for k := range prods {
		f.Productions = append(f.Productions, k)
	}
	sort.Strings(f.Productions)
	f.Trees = []string{pa.render(a, false), pb.render(b, false)}
	return f
}

// check reads one sentence every way and returns what it finds.
func (l *grammarLab) check(toks []grammarToken) []grammarFinding {
	var out []grammarFinding
	tsr := l.read(l.ts, toks, grammarParseMode{})
	for _, effect := range []bool{true, false} {
		full := l.read(l.g, toks, grammarParseMode{effect: effect, prose: true})
		if full.incomplete {
			out = append(out, grammarFinding{Kind: "budget", At: "Script", Parts: grammarTextKey(grammarSpell(toks)), Sentence: grammarSpell(toks), Effect: effect})
			continue
		}
		if full.count >= 2 {
			out = append(out, grammarPair("ambiguous", effect, toks, full.p, full.trees[0], full.p, full.trees[1]))
			continue
		}
		prod := l.read(l.g, toks, grammarParseMode{effect: effect})
		switch {
		case prod.count == 1 && full.count == 1 && prod.flat(0) != full.flat(0):
			out = append(out, grammarPair("prose-disagrees", effect, toks, prod.p, prod.trees[0], full.p, full.trees[0]))
		case prod.count == 1 && full.count == 0 && effect && l.read(l.g, toks, grammarParseMode{effect: effect, filters: true}).count == 0:
			// A rule that rejects a whole derivation, such as "a
			// parenthesized group followed by another ( is the limit",
			// rejected the productions' only reading. Keyword and
			// line-break rules reject on purpose; lineCheck holds those to
			// the productions.
			f := grammarPair("prose-rejects", effect, toks, prod.p, prod.trees[0], prod.p, prod.trees[0])
			f.Trees = f.Trees[:1]
			out = append(out, f)
		}
		// TypeScript keeps its meaning: outside effect code always, and in
		// effect code unless the sentence names a word effect code reserves.
		if tsr.count == 1 && (!effect || !l.usesReserved(tsr)) && !l.saysSyntaxError(toks) {
			switch {
			case full.count == 0:
				f := grammarPair("ts-rejected", effect, toks, tsr.p, tsr.trees[0], tsr.p, tsr.trees[0])
				f.Trees = f.Trees[:1]
				// Named by the word the keyword table or a reserved-word
				// rule governs nearest before where VibeLang's reading stops.
				at := l.failsAtMode(toks, grammarParseMode{effect: effect, prose: true})
				f.At, f.Parts = "Script", "end"
				if at < len(toks) {
					f.Parts = toks[at].text
				}
				for i := min(at, len(toks)-1); i >= max(0, at-3); i-- {
					if l.prose.words[toks[i].text] || l.prose.reservedAny(toks[i].text) {
						f.Parts = toks[i].text
						break
					}
				}
				out = append(out, f)
			case full.count == 1 && full.flat(0) != tsr.flat(0):
				out = append(out, grammarPair("ts-changed", effect, toks, tsr.p, tsr.trees[0], full.p, full.trees[0]))
			}
		}
	}
	return out
}

// usesReserved reports whether a TypeScript derivation uses a word effect
// code reserves as an identifier.
func (l *grammarLab) usesReserved(r grammarReading) bool {
	found := false
	var walk func(t *grammarPtree)
	walk = func(t *grammarPtree) {
		if t.rule < 0 {
			return
		}
		rr := &r.p.g.rules[t.rule]
		k := 0
		for _, kid := range t.kids {
			for k < len(rr.rhs) && rr.rhs[k].kind != grammarSymNT && rr.rhs[k].kind != grammarSymTok && rr.rhs[k].kind != grammarSymClass {
				k++
			}
			if kid.rule == -1 && k < len(rr.rhs) && rr.rhs[k].kind == grammarSymClass && l.prose.reserved[rr.rhs[k].text][r.p.toks[kid.i].text] {
				found = true
			}
			walk(kid)
			k++
		}
	}
	walk(r.trees[0])
	return found
}

// relex checks the sentence written tightly: when that lexes into other
// tokens that read differently, the grammar depends on a token boundary.
func (l *grammarLab) relex(toks []grammarToken) []grammarFinding {
	again := grammarLexSource(grammarTight(toks))
	if len(again) == len(toks) {
		return nil
	}
	// The first token the tight spelling lexes differently.
	at := 0
	for at < len(again) && again[at].text == toks[at].text {
		at++
	}
	var out []grammarFinding
	for _, effect := range []bool{true, false} {
		mode := grammarParseMode{effect: effect, prose: true}
		a := l.read(l.g, toks, mode)
		// Only a token boundary an Appendix A rule needs: TypeScript's own,
		// such as "x! = y" against "x != y", is TypeScript's business.
		if a.count != 1 || !grammarTokenInVibeRule(a.p, a.trees[0], at) {
			continue
		}
		b := l.read(l.g, again, mode)
		if b.count == 1 && b.flat(0) == a.flat(0) {
			continue
		}
		f := grammarPair("relex", effect, toks, a.p, a.trees[0], a.p, a.trees[0])
		f.Sentence = grammarTight(toks)
		f.Trees = []string{a.p.render(a.trees[0], false), fmt.Sprintf("relexed as %q: %d derivations", grammarSpell(again), b.count)}
		out = append(out, f)
	}
	return out
}

// grammarTokenPools are the words the generator writes for each identifier class:
// mostly plain names, and sometimes the contextual words, whose two
// readings are where VibeLang's grammar meets TypeScript's.
var grammarTokenPools = map[string][]string{
	"plain":   {"a", "b", "x", "f", "T", "U"},
	"context": {"effect", "fork", "join", "provide", "service", "error", "schema", "data", "concurrent", "restore", "uninterruptible", "as", "of", "key", "get", "type", "async", "readonly", "defaultValue", "in"},
}

// A grammarGenerator writes random sentences from a grammar, preferring Appendix
// A's productions.
type grammarGenerator struct {
	g        *grammarCfg
	rng      *rand.Rand
	maxDepth int
	maxLen   int
	out      []grammarToken
	force    int8 // the next token's line: 0 free, 1 same line, 2 new line
	pBreak   float64
	reach    []bool
}

func grammarNewGenerator(g *grammarCfg, seed int64) *grammarGenerator {
	gen := &grammarGenerator{g: g, rng: rand.New(rand.NewSource(seed)), maxDepth: 9, maxLen: 40, pBreak: 0.12}
	gen.reach = make([]bool, len(g.names))
	for nt := range g.names {
		gen.reach[nt] = g.vibe[nt]
	}
	for changed := true; changed; {
		changed = false
		for _, r := range g.rules {
			if gen.reach[r.lhs] {
				continue
			}
			for _, s := range r.rhs {
				if s.kind == grammarSymNT && gen.reach[s.nt] {
					gen.reach[r.lhs] = true
					changed = true
					break
				}
			}
		}
	}
	return gen
}

func (gen *grammarGenerator) sentence() []grammarToken {
	for range 20 {
		gen.out = gen.out[:0]
		gen.force = 0
		if gen.nt(gen.g.startE, 0) && len(gen.out) > 0 && len(gen.out) <= gen.maxLen {
			return slices.Clone(gen.out)
		}
	}
	return nil
}

func (gen *grammarGenerator) emit(text string, kind byte) bool {
	t := grammarToken{text: text, kind: kind}
	switch gen.force {
	case 1:
	case 2:
		t.nl = len(gen.out) > 0
	default:
		t.nl = len(gen.out) > 0 && gen.rng.Float64() < gen.pBreak
	}
	gen.force = 0
	gen.out = append(gen.out, t)
	return len(gen.out) <= gen.maxLen
}

func (gen *grammarGenerator) nt(nt, depth int) bool {
	rules := gen.g.byLHS[nt]
	if len(rules) == 0 {
		return false
	}
	var pick int
	if depth >= gen.maxDepth {
		best := 1 << 30
		for _, r := range rules {
			if l := gen.ruleLen(r); l < best {
				best, pick = l, r
			}
		}
	} else {
		weights := make([]float64, len(rules))
		total := 0.0
		for i, r := range rules {
			w := 1.0
			if gen.g.rules[r].vibe && !gen.g.helper[nt] {
				w *= 6
			}
			for _, s := range gen.g.rules[r].rhs {
				if s.kind == grammarSymNT && gen.reach[s.nt] {
					w *= 2
					break
				}
			}
			// Recursion deep in the tree is costly; prefer short rules.
			w /= float64(1 + depth*gen.ruleLen(r)/8)
			weights[i] = w
			total += w
		}
		x := gen.rng.Float64() * total
		for i, w := range weights {
			pick = rules[i]
			if x < w {
				break
			}
			x -= w
		}
	}
	for _, s := range gen.g.rules[pick].rhs {
		if !gen.sym(s, depth+1) {
			return false
		}
	}
	return true
}

func (gen *grammarGenerator) ruleLen(r int) int {
	n := 0
	for _, s := range gen.g.rules[r].rhs {
		switch s.kind {
		case grammarSymNT:
			n += gen.g.minLen[s.nt]
		case grammarSymTok, grammarSymClass:
			n++
		}
	}
	return n
}

func (gen *grammarGenerator) sym(s grammarGsym, depth int) bool {
	switch s.kind {
	case grammarSymNT:
		return gen.nt(s.nt, depth)
	case grammarSymTok:
		kind := byte('p')
		if grammarIsWordRune([]rune(s.text)[0]) {
			kind = 'w'
		}
		return gen.emit(s.text, kind)
	case grammarSymClass:
		return gen.class(s.text)
	case grammarSymNoLT:
		gen.force = 1
	case grammarSymLT:
		gen.force = 2
	case grammarSymASI:
		if gen.rng.Intn(2) == 0 {
			return gen.emit(";", 'p')
		}
		gen.force = 2
	}
	return true
}

func (gen *grammarGenerator) class(c string) bool {
	switch c {
	case "IdentifierReference", "BindingIdentifier", "LabelIdentifier", "IdentifierName":
		pool := grammarTokenPools["plain"]
		if gen.rng.Intn(4) == 0 {
			pool = grammarTokenPools["context"]
		}
		w := pool[gen.rng.Intn(len(pool))]
		if c != "IdentifierName" && grammarReservedWords[w] {
			w = "a"
		}
		return gen.emit(w, 'w')
	case "StringLiteral":
		return gen.emit(`"s"`, 's')
	case "NumericLiteral":
		return gen.emit("1", 'n')
	case "TemplateLiteral":
		return gen.emit("`t`", 't')
	}
	return gen.emit(c, 'x')
}

// grammarTokenInVibeRule reports whether token i is matched directly by an
// Appendix A rule in the derivation.
func grammarTokenInVibeRule(p *grammarEarley, t *grammarPtree, i int) bool {
	if t.rule < 0 {
		return false
	}
	for _, k := range t.kids {
		if k.rule == -1 && k.i == i && p.g.rules[t.rule].vibe {
			return true
		}
		if k.i <= i && k.j > i && grammarTokenInVibeRule(p, k, i) {
			return true
		}
	}
	return false
}

// lineCheck compares a sentence with the same sentence with the line break
// before token k toggled. ECMAScript makes a line break matter only through
// ASI and [no LineTerminator here]; when the productions read both
// sentences alike and the prose rules don't, a prose rule makes a line break
// matter that the productions don't show.
func (l *grammarLab) lineCheck(toks []grammarToken, k int) []grammarFinding {
	other := slices.Clone(toks)
	other[k].nl = !other[k].nl
	var out []grammarFinding
	for _, effect := range []bool{true, false} {
		pa := l.read(l.g, toks, grammarParseMode{effect: effect})
		pb := l.read(l.g, other, grammarParseMode{effect: effect})
		if pa.count != pb.count || pa.count == 1 && pa.flat(0) != pb.flat(0) || pa.count > 1 {
			continue
		}
		fa := l.read(l.g, toks, grammarParseMode{effect: effect, prose: true})
		fb := l.read(l.g, other, grammarParseMode{effect: effect, prose: true})
		if fa.count == fb.count && (fa.count != 1 || fa.flat(0) == fb.flat(0)) {
			continue
		}
		if pa.count == 0 {
			continue
		}
		f := grammarFinding{Kind: "prose-line", Effect: effect, Sentence: grammarSpell(toks)}
		prods := map[string]bool{}
		pa.p.productions(pa.trees[0], prods)
		f.At = l.lineSite(pa, k)
		f.Productions = []string{f.At}
		f.Trees = []string{
			fmt.Sprintf("productions, either way: %s", pa.p.render(pa.trees[0], false)),
			fmt.Sprintf("prose rules: %d derivation(s) for %q, %d for %q", fa.count, grammarSpell(toks), fb.count, grammarSpell(other)),
		}
		out = append(out, f)
	}
	return out
}

// lineSite names the innermost Appendix A production that holds both the
// tokens around the line break.
func (l *grammarLab) lineSite(r grammarReading, k int) string {
	site := "Script"
	var walk func(t *grammarPtree)
	walk = func(t *grammarPtree) {
		if t.rule < 0 {
			return
		}
		if r.p.g.rules[t.rule].vibe && !r.p.g.helper[t.nt] {
			site = r.p.g.base(t.nt)
		}
		for _, kid := range t.kids {
			if kid.i <= k-1 && kid.j > k {
				walk(kid)
			}
		}
	}
	walk(r.trees[0])
	return site
}

// grammarStartsTryBlock reports whether a sentence has "try" then "{": the prose
// rule that makes a statement starting so TypeScript's try statement removes
// the productions' TryExpression reading on purpose.
func grammarStartsTryBlock(toks []grammarToken) bool {
	for i := 0; i+1 < len(toks); i++ {
		if toks[i].text == "try" && toks[i+1].text == "{" {
			return true
		}
	}
	return false
}

// A grammarSearch is the sentences one search checks and what it found,
// one witness per key.
type grammarSearch struct {
	sentences [][]grammarToken
	lines     [][]grammarToken // sentences whose line breaks lineCheck toggles
	found     map[string]grammarFinding
	checked   int
}

// search returns the bounded exhaustive search's sentences and the random
// generator's, sampled under -short so the target's seeds stay under its
// budget. VIBELANG_GRAMMAR_FULL=1 checks every variant.
func (l *grammarLab) search(short bool) *grammarSearch {
	e := grammarNewEnumerator(l.g)
	base := e.sentences(24)
	// TypeScript's own phrases, so the contextual keywords meet every
	// TypeScript position (xs.join(","), error as T, service as T).
	base = append(base, grammarNewEnumerator(l.ts).tsSentences(16)...)
	var all [][]grammarToken
	all = append(all, base...)
	full := os.Getenv("VIBELANG_GRAMMAR_FULL") == "1"
	for i, toks := range base {
		if len(toks) > 16 {
			continue
		}
		vs := l.variants(toks)
		if short && !full {
			vs = grammarSampleN(vs, 3, int64(i))
		}
		all = append(all, vs...)
	}
	random := 2000
	if short && !full {
		random = 300
	}
	for _, g := range []*grammarCfg{l.g, l.ts} {
		gen := grammarNewGenerator(g, 1)
		for range random {
			if toks := gen.sentence(); toks != nil {
				all = append(all, toks)
			}
		}
	}
	if short && !full {
		all = grammarSampleN(all, 4000, 1)
	}
	var lines [][]grammarToken
	for _, toks := range base {
		if len(toks) <= 16 {
			lines = append(lines, toks)
		}
	}
	if short && !full {
		lines = grammarSampleN(lines, 600, 2)
	}
	return &grammarSearch{sentences: all, lines: lines, found: map[string]grammarFinding{}}
}

// run checks every sentence on GRAMMAR_WORKERS goroutines (8 by default;
// the build host is shared), keeping the shortest witness of each key.
func (s *grammarSearch) run(l *grammarLab) {
	workers := 8
	if n, err := strconv.Atoi(os.Getenv("GRAMMAR_WORKERS")); err == nil && n > 0 {
		workers = n
	}
	jobs := make(chan func() []grammarFinding)
	results := make(chan []grammarFinding)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				results <- job()
			}
		}()
	}
	go func() {
		results <- l.staticFindings()
		for _, toks := range s.sentences {
			jobs <- func() []grammarFinding { return append(l.check(toks), l.relex(toks)...) }
		}
		for _, toks := range s.lines {
			jobs <- func() []grammarFinding {
				var out []grammarFinding
				for k := 1; k < len(toks); k++ {
					out = append(out, l.lineCheck(toks, k)...)
				}
				return out
			}
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()
	for fs := range results {
		for _, f := range fs {
			if old, ok := s.found[f.Key()]; !ok || len(f.Sentence) < len(old.Sentence) || len(f.Sentence) == len(old.Sentence) && f.Sentence < old.Sentence {
				s.found[f.Key()] = f
			}
		}
	}
	s.checked = len(s.sentences)
}

// describe lists what the grammar holds beyond its productions: the prose
// terminals with their lines and meanings, names it leaves unresolved,
// where the subset admits each production, the prose rules it applies and
// the keyword-table cells it can't check.
func (l *grammarLab) describe() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Appendix A: %d productions, %d grammar rules with the TypeScript subset\n", len(l.a.defs), len(l.g.rules)/2)
	for _, p := range l.g.prose {
		meaning := p.Meaning
		if meaning == "" {
			meaning = "uninterpreted: an opaque terminal"
		}
		fmt.Fprintf(&b, "prose terminal %s:%d %s = %q: %s\n", l.a.file, p.Line, p.Name, p.Text, meaning)
	}
	for _, n := range l.g.unresolved {
		fmt.Fprintf(&b, "unresolved name %s: neither Appendix A nor the subset defines it; an opaque terminal\n", n)
	}
	for _, h := range l.g.hooks {
		fmt.Fprintf(&b, "placed %s\n", h)
	}
	for _, r := range l.prose.rules {
		fmt.Fprintf(&b, "prose rule %s: %q\n", r.Kind, r.Text)
	}
	for _, u := range l.prose.unread {
		fmt.Fprintf(&b, "keyword cell read as either keyword or identifier: %s\n", u)
	}
	return b.String()
}

// example holds a sentence of an Appendix A text block to what its line
// says: "syntax error" means no derivation, anything else exactly one, in
// effect code or outside it.
func (l *grammarLab) example(ex grammarExample) (grammarFinding, bool) {
	// An ellipsis elides code; a line naming an error other than a syntax
	// error (a static rule, such as "try outside effect code") says nothing
	// about the grammar.
	if strings.ContainsAny(ex.Sentence, "…") || ex.Meaning == "" || strings.Contains(ex.Meaning, "outside effect code") || strings.HasPrefix(ex.Meaning, "error") {
		return grammarFinding{}, false
	}
	toks := grammarLexSource(ex.Sentence)
	want := !strings.HasPrefix(ex.Meaning, "syntax error")
	counts := [2]int64{}
	for i, effect := range []bool{false, true} {
		counts[i] = l.read(l.g, toks, grammarParseMode{effect: effect, prose: true}).count
	}
	got := counts[0] == 1 || counts[1] == 1
	if !want {
		got = counts[0] != 0 || counts[1] != 0
	}
	if got == want || !want && !got {
		if want == got {
			return grammarFinding{}, false
		}
	}
	return grammarFinding{
		Kind:     "example",
		Sentence: ex.Sentence,
		At:       l.a.file,
		Parts:    grammarTextKey(ex.Sentence),
		Trees:    []string{fmt.Sprintf("Appendix A says %q; derivations outside effect code %d, in effect code %d", ex.Meaning, counts[0], counts[1])},
	}, true
}

// firstVibe names the first Appendix A production a derivation uses, in
// preorder.
func (p *grammarEarley) firstVibe(t *grammarPtree) string {
	if t.rule < 0 {
		return ""
	}
	if p.g.rules[t.rule].vibe {
		name := p.g.base(t.nt)
		if at := strings.IndexAny(name, "#:|"); at > 0 {
			name = name[:at]
		}
		// Appendix A may restate a TypeScript production with VibeLang's
		// alternative added (ShortCircuitExpression); the VibeLang
		// production is further in.
		if !grammarTsNames()[name] {
			return name
		}
	}
	for _, k := range t.kids {
		if n := p.firstVibe(k); n != "" {
			return n
		}
	}
	return ""
}

// saysSyntaxError reports whether an Appendix A text block says a sentence
// that starts as this one does is a syntax error, as "error as T;" is in a
// specification that makes "error" before a name a declaration: the
// specification breaks that TypeScript on purpose.
func (l *grammarLab) saysSyntaxError(toks []grammarToken) bool {
	for _, ex := range l.a.examples {
		if !strings.HasPrefix(ex.Meaning, "syntax error") {
			continue
		}
		et := grammarLexSource(ex.Sentence)
		if len(et) >= 2 && len(toks) >= 2 && et[0].text == toks[0].text && et[1].text == toks[1].text {
			return true
		}
	}
	return false
}

// staticFindings are what the grammar shows without a sentence: names no
// production defines, and token boundaries an Appendix A rule needs that
// the lexer doesn't keep, such as "!" before "=" in "A!! = x", which lexes
// as "!" "!=".
func (l *grammarLab) staticFindings() []grammarFinding {
	var out []grammarFinding
	for _, n := range l.g.unresolved {
		if strings.HasPrefix(n, "[") {
			continue
		}
		out = append(out, grammarFinding{Kind: "undefined", At: n, Parts: n, Trees: []string{"no production defines " + n + ", and it isn't the TypeScript subset's"}})
	}
	follow := l.g.follow()
	g := l.g
	seen := map[string]bool{}
	for r, rule := range g.rules {
		if !rule.vibe {
			continue
		}
		for k, s := range rule.rhs {
			if s.kind != grammarSymTok || grammarIsWordRune([]rune(s.text)[0]) {
				continue
			}
			// The tokens that can follow s here: the next symbol's first
			// tokens, or, at the end of the rule, what follows its
			// production.
			next := map[string]bool{}
			end := true
			for _, t := range rule.rhs[k+1:] {
				if t.kind == grammarSymNT {
					for key := range g.first[t.nt] {
						next[key] = true
					}
					if !g.nullable[t.nt] {
						end = false
						break
					}
				} else if t.kind == grammarSymTok || t.kind == grammarSymClass {
					next[grammarTermKey(t)] = true
					end = false
					break
				}
			}
			if end {
				for key := range follow[rule.lhs] {
					next[key] = true
				}
			}
			for key := range next {
				b, ok := strings.CutPrefix(key, "t:")
				if !ok || grammarIsWordRune([]rune(b)[0]) {
					continue
				}
				if toks := grammarLexSource(s.text + b); len(toks) != 2 || toks[0].text != s.text {
					name := g.base(rule.lhs)
					if at := strings.IndexAny(name, "#:|"); at > 0 {
						name = name[:at]
					}
					id := name + ":" + s.text + b
					if seen[id] {
						continue
					}
					seen[id] = true
					var spelled []string
					for _, t := range toks {
						spelled = append(spelled, fmt.Sprintf("%q", t.text))
					}
					out = append(out, grammarFinding{Kind: "relex", At: name, Parts: fmt.Sprintf("%q+%q", s.text, b), Sentence: s.text + b,
						Trees: []string{fmt.Sprintf("%s (%s) can end with %q, and %q can follow it; written together they lex as %s", name, g.ruleString(r), s.text, b, strings.Join(spelled, " "))}})
				}
			}
		}
	}
	return out
}

// variants returns a sentence with a line break toggled next to each token
// an Appendix A rule matches, and with each identifier made each word the
// keyword table or a reserved-word rule governs, in turn.
func (l *grammarLab) variants(toks []grammarToken) [][]grammarToken {
	r := l.read(l.g, toks, grammarParseMode{effect: true})
	near := map[int]bool{}
	if r.count >= 1 {
		var walk func(t *grammarPtree)
		walk = func(t *grammarPtree) {
			if t.rule < 0 {
				return
			}
			for _, k := range t.kids {
				if k.rule == -1 && r.p.g.rules[t.rule].vibe {
					near[k.i] = true
					near[k.i+1] = true
				}
				walk(k)
			}
		}
		walk(r.trees[0])
	} else {
		for i := range toks {
			near[i] = true
		}
	}
	var out [][]grammarToken
	for i := 1; i < len(toks); i++ {
		if !near[i] {
			continue
		}
		v := slices.Clone(toks)
		v[i].nl = !v[i].nl
		out = append(out, v)
	}
	words := []string{"as", "of"}
	for w := range l.prose.words {
		words = append(words, w)
	}
	for _, ws := range l.prose.reserved {
		for w := range ws {
			words = append(words, w)
		}
	}
	sort.Strings(words)
	words = slices.Compact(words)
	for i, t := range toks {
		if t.kind != 'w' || t.text != "a" {
			continue
		}
		for _, w := range words {
			v := slices.Clone(toks)
			v[i].text = w
			out = append(out, v)
		}
	}
	return out
}

// grammarTsNames are the productions the TypeScript subset defines.
var grammarTsNames = sync.OnceValue(func() map[string]bool {
	names := map[string]bool{}
	for _, l := range strings.Split(grammarTsSubset, "\n") {
		if m := production.FindStringSubmatch(l); m != nil {
			names[m[1]] = true
		}
	}
	return names
})

type grammarVibeBlock struct {
	line     int
	text     string
	rejected bool
}

var grammarVibeFence = regexp.MustCompile("^```vibe\\b")

// grammarVibeBlocks returns the ```vibe blocks of a document.
func grammarVibeBlocks(doc string) []grammarVibeBlock {
	var out []grammarVibeBlock
	lines := strings.Split(doc, "\n")
	for i := 0; i < len(lines); i++ {
		if !grammarVibeFence.MatchString(strings.TrimSpace(lines[i])) {
			continue
		}
		start := i + 1
		j := start
		for j < len(lines) && strings.TrimSpace(lines[j]) != "```" {
			j++
		}
		body := strings.Join(lines[start:j], "\n")
		rejected := false
		for _, l := range lines[start:j] {
			if strings.HasPrefix(strings.TrimSpace(l), "// rejected") {
				rejected = true
			}
		}
		out = append(out, grammarVibeBlock{line: start, text: body, rejected: rejected})
		i = j
	}
	return out
}

// grammarPinnedProposal names the pinned TC39 proposal an example uses, if any:
// Appendix A pins pattern matching, do expressions and the Hack pipe by
// commit, not by production, so the search can't parse them.
func grammarPinnedProposal(toks []grammarToken) string {
	for i, t := range toks {
		next := ""
		if i+1 < len(toks) {
			next = toks[i+1].text
		}
		switch {
		case t.text == "match" && next == "(":
			return "pattern matching"
		case t.text == "do" && next == "{":
			return "do expressions"
		case t.text == "|" && next == ">":
			return "the Hack pipe"
		}
	}
	return ""
}

// grammarTextKey names a sentence or example by a hash of its text, which stays
// put when the lines around it move.
func grammarTextKey(s string) string {
	h := fnv.New32a()
	h.Write([]byte(strings.Join(strings.Fields(s), " ")))
	return fmt.Sprintf("%08x", h.Sum32())
}

// failsAt returns the index of the first token no derivation reaches.
func (l *grammarLab) failsAt(toks []grammarToken) int {
	return l.failsAtMode(toks, grammarParseMode{prose: true, names: true})
}

func (l *grammarLab) failsAtMode(toks []grammarToken, mode grammarParseMode) int {
	p := l.g.parse(toks, mode, l.prose)
	for i := 1; i <= len(toks); i++ {
		if len(p.sets[i]) == 0 {
			return i - 1
		}
	}
	return len(toks)
}

// grammarDifferingVibe names the innermost Appendix A production that one reading
// has and the other lacks, with the same span: what a split in a statement
// list is about.
func grammarDifferingVibe(p *grammarEarley, a, b *grammarPtree) string {
	type node struct {
		name string
		i, j int
	}
	collect := func(t *grammarPtree) map[node]bool {
		out := map[node]bool{}
		var walk func(t *grammarPtree)
		walk = func(t *grammarPtree) {
			if t.rule < 0 {
				return
			}
			if p.g.rules[t.rule].vibe {
				name := p.g.base(t.nt)
				if at := strings.IndexAny(name, "#:|"); at > 0 {
					name = name[:at]
				}
				if !grammarTsNames()[name] {
					out[node{name, t.i, t.j}] = true
				}
			}
			for _, k := range t.kids {
				walk(k)
			}
		}
		walk(t)
		return out
	}
	na, nb := collect(a), collect(b)
	best := node{}
	for _, side := range [][2]map[node]bool{{na, nb}, {nb, na}} {
		for n := range side[0] {
			if side[1][n] {
				continue
			}
			if best.name == "" || n.j-n.i < best.j-best.i || n.j-n.i == best.j-best.i && n.name < best.name {
				best = n
			}
		}
	}
	return best.name
}

package vibelangfuzz

import (
	"strings"
)

// An Earley parser over tokens that counts derivations. A sentence is a
// list of tokens, each marked when a line break precedes it, so the
// grammar's line-break restrictions are checks on the next token rather
// than tokens of their own. ASI is ECMAScript's rule 1: a semicolon is
// inserted before a token no production allows there (the offending
// token) when a line break or "}" precedes it, and at the end of the input.
// The parser sees the token offending when no item of the set scans it.

type grammarToken struct {
	text string
	nl   bool // a line break precedes it
	kind byte // 'w' word, 's' string, 'n' number, 't' template, 'p' punctuator, 'x' prose terminal
}

// grammarReservedWords are ECMAScript's reserved words in strict code, which
// modules are, and TypeScript's strict-mode keywords.
var grammarReservedWords = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public`) {
		grammarReservedWords[w] = true
	}
}

// A grammarParseMode selects the grammar: effect code ([+Effect]) or not, and
// whether Appendix A's prose rules (its keyword table and the
// disambiguation sentences) apply on top of its productions.
type grammarParseMode struct {
	effect  bool
	prose   bool
	noWords bool // with prose: leave out the keyword table and reserved words
	filters bool // the productions, then the prose rules that reject whole derivations
	names   bool // with prose: a property name is never a keyword, the reading the examples assume
}

type grammarKwState uint8

const (
	grammarKwBoth grammarKwState = iota // the word may be either
	grammarKwYes                        // the word is the keyword here
	grammarKwNo                         // the word is an identifier here
)

type grammarEitem struct{ rule, dot, origin int32 }

type grammarEarley struct {
	g     *grammarCfg
	toks  []grammarToken
	mode  grammarParseMode
	words map[string]bool            // contextual keywords the table governs
	kw    [2][]grammarKwState        // in prose mode, each token's keyword state outside and in effect code
	resv  map[string]map[string]bool // in prose mode, identifier classes effect code excludes a word from

	sets      [][]grammarEitem
	seen      []map[grammarEitem]bool
	predicted []map[int]bool
	emptyDone []map[int]bool
	asiOK     []bool
	ends      map[[2]int32][]int32
	done      map[[3]int32]bool

	memoNT  map[[3]int32]int64
	memoSeq map[[4]int32]int64
	cyclic  bool
}

const grammarCountCap = int64(1) << 40

func grammarSat(a, b int64) int64 {
	if a+b > grammarCountCap {
		return grammarCountCap
	}
	return a + b
}

func grammarSatMul(a, b int64) int64 {
	if a == 0 || b == 0 {
		return 0
	}
	if a > grammarCountCap/b {
		return grammarCountCap
	}
	return a * b
}

func (g *grammarCfg) parse(toks []grammarToken, mode grammarParseMode, rules *grammarProseSet) *grammarEarley {
	p := &grammarEarley{g: g, toks: toks, mode: mode}
	if mode.prose && rules != nil && !mode.noWords {
		p.words = rules.words
		p.kw[0] = rules.mark(toks, false, g)
		p.kw[1] = rules.mark(toks, true, g)
		p.resv = rules.reserved
	}
	n := len(toks)
	p.sets = make([][]grammarEitem, n+2)
	p.seen = make([]map[grammarEitem]bool, n+2)
	p.predicted = make([]map[int]bool, n+2)
	p.emptyDone = make([]map[int]bool, n+2)
	for i := range p.seen {
		p.seen[i] = map[grammarEitem]bool{}
		p.predicted[i] = map[int]bool{}
		p.emptyDone[i] = map[int]bool{}
	}
	p.asiOK = make([]bool, n+1)
	p.ends = map[[2]int32][]int32{}
	p.done = map[[3]int32]bool{}
	for _, r := range g.byLHS[p.startNT()] {
		p.add(0, grammarEitem{int32(r), 0, 0})
	}
	for i := 0; i <= n; i++ {
		p.process(i)
	}
	p.memoNT = map[[3]int32]int64{}
	p.memoSeq = map[[4]int32]int64{}
	return p
}

func (p *grammarEarley) startNT() int {
	if p.mode.effect {
		return p.g.startE
	}
	return p.g.start
}

func (p *grammarEarley) kwAt(s grammarGsym, i int) grammarKwState {
	if p.kw[0] == nil {
		return grammarKwBoth
	}
	if s.eff {
		return p.kw[1][i]
	}
	return p.kw[0][i]
}

func (p *grammarEarley) add(i int, it grammarEitem) {
	if !p.seen[i][it] {
		p.seen[i][it] = true
		p.sets[i] = append(p.sets[i], it)
	}
}

func (p *grammarEarley) process(i int) {
	g := p.g
	n := len(p.toks)
	var pending []grammarEitem
	decided := false
	for k := 0; ; {
		for ; k < len(p.sets[i]); k++ {
			it := p.sets[i][k]
			r := &g.rules[it.rule]
			if int(it.dot) == len(r.rhs) {
				key := [3]int32{it.rule, it.origin, int32(i)}
				if !p.done[key] {
					p.done[key] = true
					ek := [2]int32{int32(r.lhs), it.origin}
					if e := p.ends[ek]; len(e) == 0 || e[len(e)-1] != int32(i) {
						p.ends[ek] = append(e, int32(i))
					}
				}
				if int(it.origin) == i {
					p.emptyDone[i][r.lhs] = true
				}
				origin := p.sets[it.origin]
				for m := 0; m < len(origin); m++ {
					o := origin[m]
					or := &g.rules[o.rule]
					if int(o.dot) < len(or.rhs) && or.rhs[o.dot].kind == grammarSymNT && or.rhs[o.dot].nt == r.lhs {
						p.add(i, grammarEitem{o.rule, o.dot + 1, o.origin})
					}
					origin = p.sets[it.origin]
				}
				continue
			}
			s := r.rhs[it.dot]
			next := grammarEitem{it.rule, it.dot + 1, it.origin}
			switch s.kind {
			case grammarSymNT:
				if !p.predicted[i][s.nt] {
					p.predicted[i][s.nt] = true
					for _, r2 := range g.byLHS[s.nt] {
						if g.ruleNullable[r2] || i < n && p.startsWith(r2, i) {
							p.add(i, grammarEitem{int32(r2), 0, int32(i)})
						}
					}
				}
				if p.emptyDone[i][s.nt] {
					p.add(i, next)
				}
			case grammarSymTok, grammarSymClass:
				if i < n && p.match(s, i) {
					p.add(i+1, next)
				}
			case grammarSymASI, grammarSymEnd:
				if s.kind == grammarSymEnd && (!p.mode.prose || i < n && p.toks[i].text == ";") {
					p.add(i, next)
					continue
				}
				if decided {
					if p.asiOK[i] {
						p.add(i, next)
					}
				} else {
					pending = append(pending, it)
				}
			default:
				if p.holds(s, i) {
					p.add(i, next)
				}
			}
		}
		if decided || len(pending) == 0 {
			return
		}
		decided = true
		p.asiOK[i] = i == n || p.toks[i].text == "}" || p.toks[i].nl && len(p.sets[i+1]) == 0
		if !p.asiOK[i] {
			return
		}
		for _, it := range pending {
			p.add(i, grammarEitem{it.rule, it.dot + 1, it.origin})
		}
	}
}

// startsWith reports whether rule r can start with token i.
func (p *grammarEarley) startsWith(r, i int) bool {
	t := p.toks[i]
	f := p.g.ruleFirst[r]
	if f["t:"+t.text] && t.kind != 's' && t.kind != 't' {
		return true
	}
	switch t.kind {
	case 'w':
		return f["c:IdentifierName"] || f["c:IdentifierReference"] || f["c:BindingIdentifier"] || f["c:LabelIdentifier"]
	case 's':
		return f["c:StringLiteral"]
	case 'n':
		return f["c:NumericLiteral"]
	case 't':
		return f["c:TemplateLiteral"]
	case 'x':
		return f["c:"+t.text]
	}
	return false
}

func (p *grammarEarley) match(s grammarGsym, i int) bool {
	t := p.toks[i]
	if s.kind == grammarSymTok {
		if t.text != s.text || t.kind == 's' || t.kind == 't' || t.kind == 'x' {
			return false
		}
		if p.words[t.text] {
			return p.kwAt(s, i) != grammarKwNo
		}
		return true
	}
	switch s.text {
	case "IdentifierName":
		// A word the keyword table makes a keyword here is a keyword
		// token, as a lexer applying the table would make it.
		return t.kind == 'w' && (p.mode.names || !(p.words[t.text] && p.kwAt(s, i) == grammarKwYes))
	case "IdentifierReference", "BindingIdentifier", "LabelIdentifier":
		if t.kind != 'w' || grammarReservedWords[t.text] {
			return false
		}
		if p.words[t.text] && p.kwAt(s, i) == grammarKwYes {
			return false
		}
		return !s.eff || !p.resv[s.text][t.text]
	case "StringLiteral":
		return t.kind == 's'
	case "NumericLiteral":
		return t.kind == 'n'
	case "TemplateLiteral":
		return t.kind == 't'
	}
	return t.kind == 'x' && t.text == s.text
}

func (p *grammarEarley) seqAt(seq []string, i int, oneLine bool) bool {
	for k, w := range seq {
		if i+k >= len(p.toks) || p.toks[i+k].text != w || p.toks[i+k].kind == 's' {
			return false
		}
		if oneLine && k > 0 && p.toks[i+k].nl {
			return false
		}
	}
	return true
}

// holds reports whether a zero-width symbol holds before token i.
func (p *grammarEarley) holds(s grammarGsym, i int) bool {
	if s.prose && !p.mode.prose {
		return true
	}
	n := len(p.toks)
	switch s.kind {
	case grammarSymNoLT:
		return i == n || !p.toks[i].nl
	case grammarSymLT:
		return i == n || p.toks[i].nl
	case grammarSymGuard:
		return s.on == s.eff
	case grammarSymAhead:
		for _, seq := range s.seqs {
			if p.seqAt(seq, i, s.on) {
				return true
			}
		}
		return false
	case grammarSymNotAhead:
		for _, seq := range s.seqs {
			if p.seqAt(seq, i, s.on) {
				return false
			}
		}
		return true
	case grammarSymASI:
		return p.asiOK[i]
	case grammarSymEnd:
		return !p.mode.prose || i < n && p.toks[i].text == ";" || p.asiOK[i]
	}
	return false
}

// count returns the number of derivations of the whole sentence.
func (p *grammarEarley) count() int64 {
	return p.countNT(p.startNT(), 0, len(p.toks))
}

func (p *grammarEarley) countNT(nt, i, j int) int64 {
	key := [3]int32{int32(nt), int32(i), int32(j)}
	if v, ok := p.memoNT[key]; ok {
		if v < 0 {
			p.cyclic = true
			return 0
		}
		return v
	}
	p.memoNT[key] = -1
	total := int64(0)
	for _, r := range p.g.byLHS[nt] {
		if !p.done[[3]int32{int32(r), int32(i), int32(j)}] {
			continue
		}
		c := p.countSeq(r, 0, i, j)
		if p.g.ordered[nt] && c > 0 {
			total = c
			break
		}
		total = grammarSat(total, c)
	}
	p.memoNT[key] = total
	return total
}

func (p *grammarEarley) countSeq(r, k, i, j int) int64 {
	rhs := p.g.rules[r].rhs
	if k == len(rhs) {
		if i == j {
			return 1
		}
		return 0
	}
	key := [4]int32{int32(r), int32(k), int32(i), int32(j)}
	if v, ok := p.memoSeq[key]; ok {
		return v
	}
	s := rhs[k]
	total := int64(0)
	switch s.kind {
	case grammarSymTok, grammarSymClass:
		if i < j && p.match(s, i) {
			total = p.countSeq(r, k+1, i+1, j)
		}
	case grammarSymNT:
		for _, m := range p.ends[[2]int32{int32(s.nt), int32(i)}] {
			if int(m) > j {
				continue
			}
			// The rest first: a left-recursive child over the whole span
			// is a cycle only when the rest can match nothing.
			rest := p.countSeq(r, k+1, int(m), j)
			if rest == 0 {
				continue
			}
			total = grammarSat(total, grammarSatMul(p.countNT(s.nt, i, int(m)), rest))
		}
	default:
		if p.holds(s, i) {
			total = p.countSeq(r, k+1, i, j)
		}
	}
	p.memoSeq[key] = total
	return total
}

// A grammarPtree is one derivation.
type grammarPtree struct {
	nt, rule int // rule < 0 for a token
	i, j     int
	kids     []*grammarPtree
}

// tree returns derivation number n of the sentence, counting from 0.
func (p *grammarEarley) tree(n int64) *grammarPtree {
	return p.treeNT(p.startNT(), 0, len(p.toks), n)
}

func (p *grammarEarley) treeNT(nt, i, j int, n int64) *grammarPtree {
	for _, r := range p.g.byLHS[nt] {
		if !p.done[[3]int32{int32(r), int32(i), int32(j)}] {
			continue
		}
		c := p.countSeq(r, 0, i, j)
		if c == 0 {
			continue
		}
		if n < c || p.g.ordered[nt] {
			return &grammarPtree{nt: nt, rule: r, i: i, j: j, kids: p.treeSeq(r, 0, i, j, n%c)}
		}
		n -= c
	}
	return &grammarPtree{nt: nt, rule: -2, i: i, j: j}
}

func (p *grammarEarley) treeSeq(r, k, i, j int, n int64) []*grammarPtree {
	rhs := p.g.rules[r].rhs
	if k == len(rhs) {
		return nil
	}
	s := rhs[k]
	switch s.kind {
	case grammarSymTok, grammarSymClass:
		return append([]*grammarPtree{{nt: -1, rule: -1, i: i, j: i + 1}}, p.treeSeq(r, k+1, i+1, j, n)...)
	case grammarSymNT:
		for _, m := range p.ends[[2]int32{int32(s.nt), int32(i)}] {
			if int(m) > j {
				continue
			}
			c2 := p.countSeq(r, k+1, int(m), j)
			if c2 == 0 {
				continue
			}
			c1 := p.countNT(s.nt, i, int(m))
			c := grammarSatMul(c1, c2)
			if c == 0 {
				continue
			}
			if n < c {
				return append([]*grammarPtree{p.treeNT(s.nt, i, int(m), n/c2)}, p.treeSeq(r, k+1, int(m), j, n%c2)...)
			}
			n -= c
		}
		return nil
	}
	return p.treeSeq(r, k+1, i, j, n)
}

// render writes a derivation compactly: a nonterminal with one child is its
// child, unless Appendix A defines it, and helper nonterminals vanish.
// coarse leaves out semicolons and empty statements, which differ between
// readings that end a statement at the same place.
func (p *grammarEarley) render(t *grammarPtree, coarse bool) string {
	if t.rule == -1 {
		tok := p.toks[t.i]
		if coarse && tok.text == ";" {
			return ""
		}
		if tok.nl {
			return "⏎ " + tok.text
		}
		return tok.text
	}
	name := p.g.base(t.nt)
	if coarse && name == "EmptyStatement" {
		return ""
	}
	var parts []string
	for _, k := range t.kids {
		if s := p.render(k, coarse); s != "" {
			parts = append(parts, s)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	if p.g.helper[t.nt] || len(t.kids) == 1 && t.kids[0].rule != -1 && !p.g.vibe[t.nt] {
		return strings.Join(parts, " ")
	}
	return name + "(" + strings.Join(parts, " ") + ")"
}

// diverge returns the first nodes at which two derivations differ, with
// the nearest named nonterminal above them.
func (p *grammarEarley) diverge(a, b *grammarPtree, named string) (string, *grammarPtree, *grammarPtree) {
	if a.nt >= 0 && !p.g.helper[a.nt] {
		named = p.g.base(a.nt)
	}
	if a.rule != b.rule || len(a.kids) != len(b.kids) {
		return named, a, b
	}
	for k := range a.kids {
		if a.kids[k].i != b.kids[k].i || a.kids[k].j != b.kids[k].j {
			return named, a, b
		}
	}
	for k := range a.kids {
		if !grammarSameTree(a.kids[k], b.kids[k]) {
			return p.diverge(a.kids[k], b.kids[k], named)
		}
	}
	return named, a, b
}

func grammarSameTree(a, b *grammarPtree) bool {
	if a.rule != b.rule || a.i != b.i || a.j != b.j || len(a.kids) != len(b.kids) {
		return false
	}
	for k := range a.kids {
		if !grammarSameTree(a.kids[k], b.kids[k]) {
			return false
		}
	}
	return true
}

// productions lists the Appendix A productions a derivation uses.
func (p *grammarEarley) productions(t *grammarPtree, into map[string]bool) {
	if t.rule >= 0 && p.g.rules[t.rule].vibe {
		name := p.g.base(p.g.rules[t.rule].lhs)
		if !p.g.helper[t.nt] {
			into[name] = true
		} else if at := strings.IndexAny(name, "#:"); at > 0 {
			into[name[:at]] = true
		}
	}
	for _, k := range t.kids {
		p.productions(k, into)
	}
}

package vibelangfuzz

import (
	"math/rand"
	"slices"
	"strings"
)

// The bounded exhaustive search. For every rule of every Appendix A
// production, in and outside effect code, it writes the rule with each child
// at its shortest yield, then once per child and per target rule with that
// child at its shortest yield that uses the target: every VibeLang rule and
// every TypeScript rule with an operator or keyword. Each such phrase stands
// in its shortest statement context. Then each sentence gets a line break
// before each of its tokens in turn, and each identifier becomes each
// contextual keyword in turn. That covers, for instance, a catch handler
// whose arrow body is itself a catch, an Effect type whose operand is an
// Effect type, and a declaration keyword before a line break.

const grammarInf = 1 << 20

type grammarEnumerator struct {
	g       *grammarCfg
	targets []int
	with    map[int][]int // target rule → shortest length of each nonterminal using it
	ctx     [2][]int      // shortest context length of each nonterminal, from Script and Script⁺
	ctxVia  [2][][2]int   // the rule and child position that context comes through
}

func grammarNewEnumerator(g *grammarCfg) *grammarEnumerator {
	e := &grammarEnumerator{g: g, with: map[int][]int{}}
	for r, rule := range g.rules {
		if !e.possible(r) {
			continue
		}
		tokens, size := 0, 0
		for _, s := range rule.rhs {
			switch s.kind {
			case grammarSymTok:
				tokens++
				size++
			case grammarSymNT, grammarSymClass:
				size++
			}
		}
		if rule.vibe || tokens > 0 && size >= 2 {
			e.targets = append(e.targets, r)
		}
	}
	for _, t := range e.targets {
		e.with[t] = e.lengthsWith(t)
	}
	for k, start := range []int{g.start, g.startE} {
		e.ctx[k], e.ctxVia[k] = e.contexts(start)
	}
	return e
}

// possible reports whether a rule's grammar parameter allows it.
func (e *grammarEnumerator) possible(r int) bool {
	for _, s := range e.g.rules[r].rhs {
		if s.kind == grammarSymGuard && s.on != s.eff {
			return false
		}
	}
	return true
}

func (e *grammarEnumerator) ruleLen(r int) int {
	if !e.possible(r) {
		return grammarInf
	}
	n := 0
	for _, s := range e.g.rules[r].rhs {
		switch s.kind {
		case grammarSymNT:
			n += e.g.minLen[s.nt]
		case grammarSymTok, grammarSymClass:
			n++
		}
	}
	return min(n, grammarInf)
}

func (e *grammarEnumerator) lengthsWith(t int) []int {
	g := e.g
	l := make([]int, len(g.names))
	for i := range l {
		l[i] = grammarInf
	}
	l[g.rules[t].lhs] = e.ruleLen(t)
	for changed := true; changed; {
		changed = false
		for q := range g.rules {
			base := e.ruleLen(q)
			if base >= grammarInf {
				continue
			}
			for _, s := range g.rules[q].rhs {
				if s.kind != grammarSymNT || l[s.nt] >= grammarInf {
					continue
				}
				if c := base - g.minLen[s.nt] + l[s.nt]; c < l[g.rules[q].lhs] {
					l[g.rules[q].lhs] = c
					changed = true
				}
			}
		}
	}
	return l
}

func (e *grammarEnumerator) contexts(start int) ([]int, [][2]int) {
	g := e.g
	c := make([]int, len(g.names))
	via := make([][2]int, len(g.names))
	for i := range c {
		c[i] = grammarInf
		via[i] = [2]int{-1, -1}
	}
	c[start] = 0
	for changed := true; changed; {
		changed = false
		for q := range g.rules {
			lhs := g.rules[q].lhs
			if c[lhs] >= grammarInf {
				continue
			}
			base := e.ruleLen(q)
			if base >= grammarInf {
				continue
			}
			for k, s := range g.rules[q].rhs {
				if s.kind != grammarSymNT {
					continue
				}
				if v := c[lhs] + base - g.minLen[s.nt]; v < c[s.nt] {
					c[s.nt] = v
					via[s.nt] = [2]int{q, k}
					changed = true
				}
			}
		}
	}
	return c, via
}

// A grammarPhrase is tokens with line constraints still open.
type grammarPhrase struct {
	toks  []grammarToken
	force int8
}

func (p *grammarPhrase) emit(text string, kind byte) {
	p.toks = append(p.toks, grammarToken{text: text, kind: kind, nl: p.force == 2 && len(p.toks) > 0})
	p.force = 0
}

// shortest writes nonterminal nt's shortest yield.
func (e *grammarEnumerator) shortest(p *grammarPhrase, nt, depth int) {
	best, pick := grammarInf+1, -1
	for _, r := range e.g.byLHS[nt] {
		if l := e.ruleLen(r); l < best {
			best, pick = l, r
		}
	}
	if pick >= 0 && depth < 60 {
		e.rule(p, pick, -1, nil, depth)
	}
}

// rule writes rule r with its children shortest, except child k, which
// fill writes.
func (e *grammarEnumerator) rule(p *grammarPhrase, r, k int, fill func(*grammarPhrase), depth int) {
	for i, s := range e.g.rules[r].rhs {
		switch s.kind {
		case grammarSymNT:
			if i == k {
				fill(p)
			} else {
				e.shortest(p, s.nt, depth+1)
			}
		case grammarSymTok:
			kind := byte('p')
			if grammarIsWordRune([]rune(s.text)[0]) {
				kind = 'w'
			}
			p.emit(s.text, kind)
		case grammarSymClass:
			switch s.text {
			case "IdentifierReference", "BindingIdentifier", "LabelIdentifier", "IdentifierName":
				p.emit("a", 'w')
			case "StringLiteral":
				p.emit(`"s"`, 's')
			case "NumericLiteral":
				p.emit("1", 'n')
			case "TemplateLiteral":
				p.emit("`t`", 't')
			default:
				p.emit(s.text, 'x')
			}
		case grammarSymLT:
			p.force = 2
		case grammarSymNoLT:
			p.force = 1
		case grammarSymASI:
			p.emit(";", 'p')
		}
	}
}

// using writes nt's shortest yield that uses target rule t.
func (e *grammarEnumerator) using(p *grammarPhrase, nt, t, depth int) {
	l := e.with[t]
	if nt == e.g.rules[t].lhs && l[nt] == e.ruleLen(t) {
		e.rule(p, t, -1, nil, depth)
		return
	}
	for _, q := range e.g.byLHS[nt] {
		base := e.ruleLen(q)
		if base >= grammarInf || depth > 60 {
			continue
		}
		for k, s := range e.g.rules[q].rhs {
			if s.kind == grammarSymNT && l[s.nt] < grammarInf && base-e.g.minLen[s.nt]+l[s.nt] == l[nt] {
				e.rule(p, q, k, func(p *grammarPhrase) { e.using(p, s.nt, t, depth+1) }, depth)
				return
			}
		}
	}
}

// within writes nt's shortest context from Script (k 0) or Script⁺ (k 1)
// around fill.
func (e *grammarEnumerator) within(p *grammarPhrase, k, nt int, fill func(*grammarPhrase), depth int) {
	via := e.ctxVia[k][nt]
	if via[0] < 0 || depth > 60 {
		fill(p)
		return
	}
	parent := e.g.rules[via[0]].lhs
	e.within(p, k, parent, func(p *grammarPhrase) { e.rule(p, via[0], via[1], fill, depth+1) }, depth+1)
}

// sentences returns the search's phrases in a fixed order; maxLen bounds
// their length.
func (e *grammarEnumerator) sentences(maxLen int) [][]grammarToken {
	var out [][]grammarToken
	seen := map[string]bool{}
	add := func(toks []grammarToken) {
		if len(toks) == 0 || len(toks) > maxLen {
			return
		}
		if s := grammarSpell(toks); !seen[s] {
			seen[s] = true
			out = append(out, toks)
		}
	}
	for r, rule := range e.g.rules {
		if !rule.vibe || !e.possible(r) {
			continue
		}
		k := 0
		if strings.HasSuffix(e.g.names[rule.lhs], "⁺") {
			k = 1
		}
		if e.ctx[k][rule.lhs] >= grammarInf {
			continue
		}
		var base grammarPhrase
		e.within(&base, k, rule.lhs, func(p *grammarPhrase) { e.rule(p, r, -1, nil, 0) }, 0)
		add(base.toks)
		for c, s := range rule.rhs {
			if s.kind != grammarSymNT {
				continue
			}
			for _, t := range e.targets {
				if l := e.with[t][s.nt]; l >= grammarInf || l > maxLen {
					continue
				}
				var p grammarPhrase
				e.within(&p, k, rule.lhs, func(p *grammarPhrase) {
					e.rule(p, r, c, func(p *grammarPhrase) { e.using(p, s.nt, t, 0) }, 0)
				}, 0)
				add(p.toks)
			}
		}
	}
	return out
}

// grammarSampleN keeps n of a list, in a fixed pseudo-random order.
func grammarSampleN[T any](xs []T, n int, seed int64) []T {
	if len(xs) <= n {
		return xs
	}
	rng := rand.New(rand.NewSource(seed))
	idx := rng.Perm(len(xs))[:n]
	slices.Sort(idx)
	out := make([]T, n)
	for i, j := range idx {
		out[i] = xs[j]
	}
	return out
}

// tsSentences writes each rule of the grammar that has a token, with its
// children shortest, in its shortest statement context: the TypeScript
// sentences the keyword variants then turn into VibeLang's contested ones.
func (e *grammarEnumerator) tsSentences(maxLen int) [][]grammarToken {
	var out [][]grammarToken
	seen := map[string]bool{}
	for _, r := range e.targets {
		lhs := e.g.rules[r].lhs
		if strings.HasSuffix(e.g.names[lhs], "⁺") || e.ctx[0][lhs] >= grammarInf {
			continue
		}
		var p grammarPhrase
		e.within(&p, 0, lhs, func(p *grammarPhrase) { e.rule(p, r, -1, nil, 0) }, 0)
		if s := grammarSpell(p.toks); len(p.toks) > 0 && len(p.toks) <= maxLen && !seen[s] {
			seen[s] = true
			out = append(out, p.toks)
		}
	}
	return out
}

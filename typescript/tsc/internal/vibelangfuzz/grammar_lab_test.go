package vibelangfuzz

// A grammarLab is one copy of Appendix A, ready for admission checks.
type grammarLab struct {
	a     *grammarAppendixData
	g     *grammarCfg // Appendix A over the subset
	ts    *grammarCfg // the subset alone: TypeScript
	prose *grammarProseSet
}

func grammarNewGrammarLab(text, file string) (*grammarLab, error) {
	return grammarNewGrammarLabReading(text, file, false)
}

func grammarNewGrammarLabReading(text, file string, relational bool) (*grammarLab, error) {
	a, err := grammarReadAppendix(text, file)
	if err != nil {
		return nil, err
	}
	a.relational = relational
	g := grammarBuildGrammar(a)
	ps := grammarNewProseSet(a, g)
	ps.apply(g)
	ts := grammarBuildGrammar(&grammarAppendixData{file: "ts"})
	return &grammarLab{a: a, g: g, ts: ts, prose: ps}, nil
}

// A grammarReading is how one grammar parses one sentence.
type grammarReading struct {
	p     *grammarEarley
	count int64
	trees []*grammarPtree
}

func (l *grammarLab) read(g *grammarCfg, toks []grammarToken, mode grammarParseMode) grammarReading {
	var rules *grammarProseSet
	if mode.prose {
		rules = l.prose
	}
	p := g.parse(toks, mode, rules)
	c := p.count()
	r := grammarReading{p: p, count: c}
	for n := int64(0); n < min(c, 2); n++ {
		r.trees = append(r.trees, p.tree(n))
	}
	if p.cyclic && r.count > 0 {
		r.count = max(r.count, 2)
		if len(r.trees) == 1 {
			r.trees = append(r.trees, r.trees[0])
		}
	}
	return r
}

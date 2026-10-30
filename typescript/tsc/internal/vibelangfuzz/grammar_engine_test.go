package vibelangfuzz

import "testing"

// These grammars exercise the counting algorithm independently of the
// current language, including ambiguity in a nullable child.
func TestGrammarEngine(t *testing.T) {
	for _, tc := range []struct {
		name     string
		nullable bool
		input    string
		want     int64
	}{
		{"one", false, "x", 1}, {"reject", false, "y", 0},
		{"nullable ambiguity", true, "x", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g := &grammarCfg{index: map[string]int{}, ordered: map[int]bool{}, vibe: map[int]bool{}, helper: map[int]bool{}}
			s, a, b, c := g.nt("Script"), g.nt("A"), g.nt("B"), g.nt("C")
			g.start = s
			g.startE = s
			g.add(s, []grammarGsym{{kind: grammarSymNT, nt: a}, {kind: grammarSymTok, text: "x"}}, "test", false)
			g.add(a, []grammarGsym{{kind: grammarSymNT, nt: b}}, "test", false)
			g.add(b, nil, "test", false)
			if tc.nullable {
				g.add(a, []grammarGsym{{kind: grammarSymNT, nt: c}}, "test", false)
				g.add(c, nil, "test", false)
			}
			g.analyze()
			p := g.parse(grammarLexSource(tc.input), grammarParseMode{}, nil)
			if got := p.count(); got != tc.want {
				t.Fatalf("count=%d, want %d", got, tc.want)
			}
			if tc.want == 2 && grammarSameTree(p.tree(0), p.tree(1)) {
				t.Fatal("ambiguous sentence has identical witness trees")
			}
		})
	}
}

func TestGrammarLoadsCurrentAppendix(t *testing.T) {
	lab, err := grammarNewGrammarLab(SpecText(grammarAppendix), grammarAppendix)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range lab.g.unresolved {
		if name == "LineTerminator" {
			t.Fatal("LineTerminator must resolve to a line-break assertion")
		}
	}
	if len(lab.a.defs) == 0 {
		t.Fatal("no productions loaded")
	}
	names := appendixProductions(SpecText(grammarAppendix))
	for _, line := range grammarLines(lab.a.text) {
		if m := production.FindStringSubmatch(line); m != nil {
			names[m[1]] = true
		}
	}
	for name := range names {
		if len(lab.g.named(name)) == 0 {
			t.Errorf("production %s was dropped", name)
		}
	}
}

// Disabling prose restrictions must affect both chart recognition and
// forest counting, including a prose-only declaration boundary.
func TestGrammarProseBoundary(t *testing.T) {
	g := &grammarCfg{index: map[string]int{}, ordered: map[int]bool{}, vibe: map[int]bool{}, helper: map[int]bool{}}
	s := g.nt("Script")
	g.start = s
	g.startE = s
	g.add(s, []grammarGsym{{kind: grammarSymEnd}, {kind: grammarSymTok, text: "x"}}, "test", false)
	g.analyze()
	for _, prose := range []bool{false, true} {
		p := g.parse(grammarLexSource("x"), grammarParseMode{prose: prose}, nil)
		want := int64(1)
		if prose {
			want = 0
		}
		if got := p.count(); got != want {
			t.Errorf("prose=%v: count=%d, want %d", prose, got, want)
		}
	}
}

// A competing completed branch must not suppress a statement boundary
// before a closing brace in another branch of the forest.
func TestGrammarClosingBrace(t *testing.T) {
	g := &grammarCfg{index: map[string]int{}, ordered: map[int]bool{}, vibe: map[int]bool{}, helper: map[int]bool{}}
	s := g.nt("Script")
	g.start = s
	g.startE = s
	for _, boundary := range []bool{false, true} {
		rhs := []grammarGsym{{kind: grammarSymTok, text: "{"}, {kind: grammarSymTok, text: "x"}}
		if boundary {
			rhs = append(rhs, grammarGsym{kind: grammarSymASI})
		}
		rhs = append(rhs, grammarGsym{kind: grammarSymTok, text: "}"})
		g.add(s, rhs, "test", false)
	}
	g.analyze()
	p := g.parse(grammarLexSource("{x}"), grammarParseMode{}, nil)
	if got := p.count(); got != 2 {
		t.Fatalf("count=%d, want both branches", got)
	}
}

func TestGrammarInheritedFunctions(t *testing.T) {
	g := grammarBuildGrammar(&grammarAppendixData{})
	for _, src := range []string{
		"const f = function() {}", "const f = async function() {}",
		"const f = function*() {}", "const f = async function*() {}",
	} {
		p := g.parse(grammarLexSource(src), grammarParseMode{}, nil)
		if got := p.count(); got != 1 {
			t.Errorf("%s: count=%d, want one derivation", src, got)
		}
	}
}

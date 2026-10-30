package vibelangfuzz

import (
	"regexp"
	"slices"
	"strings"
)

// Appendix A's prose rules. Beside its productions, Appendix A states rules
// in words: a table of contextual keywords, which words are reserved in
// effect code, which tokens share a line, and sentences that choose between
// two readings. The search parses every sentence twice, by the productions
// alone and with these rules, and reports where the two disagree as well as
// where either reading is ambiguous. Each rule is recognized by its words;
// a sentence or table cell it can't read is listed, never dropped.

// A keywordRule is one row of the contextual keyword table.
type keywordRule struct {
	Words      []string
	Phrase     string
	effectOnly bool
	reference  bool       // "as an IdentifierReference": a keyword where a reference stands
	alts       [][]kwElem // what may follow; nil for an alternative in words the reader can't check
}

// A kwElem matches tokens after the keyword: 't' one of toks, 'n' a name,
// 'g' a parenthesized group, 'e' a token that can start an expression, 'P'
// the token before the keyword.
type kwElem struct {
	kind byte
	toks []string
}

// A proseRule is a sentence of Appendix A the search applies.
type proseRule struct {
	Kind, Text string
}

var (
	tokenSet     = regexp.MustCompile("`([^`]+)` or `([^`]+)`")
	classContext = regexp.MustCompile(`in a class or object literal[^;]*;?`)
	backtick     = regexp.MustCompile("`([^`]*)`")
	tableRow     = regexp.MustCompile(`^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*.*\|\s*$`)
	sentences    = regexp.MustCompile(`[^.]*(?:\.[^ \n][^.]*)*\.`)
)

func readKeywordTable(text string) []keywordRule {
	var out []keywordRule
	in := false
	for _, l := range strings.Split(text, "\n") {
		if strings.HasPrefix(l, "### ") {
			in = strings.Contains(l, "Contextual keywords")
			continue
		}
		m := tableRow.FindStringSubmatch(l)
		if !in || m == nil || strings.HasPrefix(m[1], "---") || m[1] == "Word" {
			continue
		}
		var words []string
		for _, w := range backtick.FindAllStringSubmatch(m[1], -1) {
			words = append(words, w[1])
		}
		out = append(out, parseKeywordPhrase(words, m[2]))
	}
	return out
}

// kwFiller are words a keyword phrase uses that check nothing.
var kwFiller = map[string]bool{"then": true, "and": true, "of": true, "an": true, "a": true, "arrow's": true, "arrow": true, "parameters": true, "such": true, "type": true, "as": true, "for": true, "methods": true, "head": true, "in": true, "class": true, "or": true, "object": true, "literal": true, "the": true, "declaration": true, "shorthand": true, "otherwise": true, "TypeScript's": true}

func parseKeywordPhrase(words []string, phrase string) keywordRule {
	k := keywordRule{Words: words, Phrase: phrase}
	p := strings.TrimSpace(phrase)
	if rest, ok := strings.CutPrefix(p, "in effect code, "); ok {
		k.effectOnly = true
		p = rest
	}
	if rest, ok := strings.CutPrefix(p, "as an `IdentifierReference`"); ok {
		k.reference = true
		k.alts = append(k.alts, nil)
		p = strings.TrimPrefix(strings.TrimSpace(rest), ":")
		// What follows ("an operand, or .in(…), …") is what the
		// IdentifierReference position already admits.
		return k
	}
	if strings.HasPrefix(p, "as TC39") {
		k.alts = append(k.alts, nil)
		return k
	}
	// Drop sentences after the first (" `effect(x)` with no `=>` is a call").
	if at := strings.Index(p, ". "); at >= 0 {
		p = p[:at]
	}
	p = strings.TrimSuffix(p, ".")
	// "in a class or object literal, a method name then `(`, or `*`": the
	// table's tokens alone can't tell a class body, so either reading
	// stays there.
	if loc := classContext.FindStringIndex(p); loc != nil {
		p = p[:loc[0]] + p[loc[1]:]
		k.alts = append(k.alts, []kwElem{{kind: 'C'}})
	}
	// "`{` or `<`" is one position that takes either token.
	p = tokenSet.ReplaceAllString(p, "`$1\x00$2`")
	for _, part := range splitKeywordAlts(p) {
		k.alts = append(k.alts, parseKeywordAlt(part)...)
	}
	return k
}

// splitKeywordAlts splits at ";", ", or", " or " and "," outside backticks
// and parentheses, except that a list after ":" or inside parentheses
// replaces the words before it.
func splitKeywordAlts(p string) []string {
	var parts []string
	depth, tick, start := 0, false, 0
	for i := 0; i < len(p); i++ {
		c := p[i]
		switch {
		case c == '`':
			tick = !tick
		case tick:
		case c == '(':
			depth++
		case c == ')':
			depth--
		case depth == 0 && (c == ';' || c == ',' && !strings.HasPrefix(p[i+1:], " then")):
			parts = append(parts, p[start:i])
			start = i + 1
		case depth == 0 && strings.HasPrefix(p[i:], " or "):
			parts = append(parts, p[start:i])
			start = i + 4
			i += 3
		}
	}
	parts = append(parts, p[start:])
	var out []string
	for _, s := range parts {
		s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "or "))
		if s == "" {
			continue
		}
		// "an arrow head, as for `async`: `(` … `)` then `=>`" keeps what
		// follows the colon.
		if at := strings.Index(s, ": "); at >= 0 {
			s = s[at+2:]
		}
		// "an arrow's parameters (`(`, `<`, or an identifier then `=>`)"
		// is the list in its parentheses.
		if open := strings.Index(s, "("); open >= 0 && strings.HasSuffix(s, ")") && !strings.HasPrefix(s, "`") && strings.Contains(s[open:], "`") {
			out = append(out, splitKeywordAlts(s[open+1:len(s)-1])...)
			continue
		}
		out = append(out, s)
	}
	return out
}

// parseKeywordAlt reads one alternative; it returns a nil alternative when
// the words check something the reader can't.
func parseKeywordAlt(s string) [][]kwElem {
	var seq []kwElem
	rest := s
	for rest = strings.TrimSpace(rest); rest != ""; rest = strings.TrimSpace(rest) {
		switch {
		case strings.HasPrefix(rest, "`(` … `)`"):
			seq = append(seq, kwElem{kind: 'g'})
			rest = rest[len("`(` … `)`"):]
		case strings.HasPrefix(rest, "`"):
			end := strings.Index(rest[1:], "`")
			if end < 0 {
				return [][]kwElem{nil}
			}
			code := rest[1 : end+1]
			rest = rest[end+2:]
			if strings.Contains(code, "\x00") {
				seq = append(seq, kwElem{kind: 't', toks: strings.Split(code, "\x00")})
				continue
			}
			toks := lexSource(strings.Split(code, "…")[0])
			for _, t := range toks {
				seq = append(seq, kwElem{kind: 't', toks: []string{t.text}})
			}
		case strings.HasPrefix(rest, "a token that can start an expression"):
			seq = append(seq, kwElem{kind: 'e'})
			rest = rest[len("a token that can start an expression"):]
		case strings.HasPrefix(rest, "after `"):
			end := strings.Index(rest[7:], "`")
			seq = append(seq, kwElem{kind: 'P', toks: []string{rest[7 : 7+end]}})
			rest = rest[7+end+1:]
		case hasWordPrefix(rest, "a method name"):
			seq = append(seq, kwElem{kind: 'n'})
			rest = rest[len("a method name"):]
		case hasWordPrefix(rest, "a name"):
			seq = append(seq, kwElem{kind: 'n'})
			rest = rest[len("a name"):]
		case hasWordPrefix(rest, "an identifier"):
			seq = append(seq, kwElem{kind: 'n'})
			rest = rest[len("an identifier"):]
		case strings.ContainsAny(rest[:1], ",;:."):
			rest = rest[1:]
		default:
			word := rest
			if at := strings.IndexAny(rest, " `"); at > 0 {
				word = rest[:at]
			}
			if word == "identifier" {
				seq = append(seq, kwElem{kind: 'n'})
			} else if !kwFiller[strings.Trim(word, "():,")] && !strings.HasPrefix(word, "(") {
				return [][]kwElem{nil}
			}
			rest = rest[len(word):]
		}
	}
	if len(seq) == 0 {
		// Only words that check nothing, such as "an arrow head" before
		// the list after its colon, or "in a class or object literal".
		return nil
	}
	return [][]kwElem{seq}
}

func hasWordPrefix(s, w string) bool {
	return strings.HasPrefix(s, w) && (len(s) == len(w) || !isWordRune(rune(s[len(w)])))
}

// A proseSet is the prose rules of one appendix, ready to apply.
type proseSet struct {
	keywords               []keywordRule
	words                  map[string]bool
	reserved               map[string]map[string]bool // identifier class → words effect code reserves
	sameLine               int                        // 1: the token after a keyword is on its line; 2: every token the table names is
	rules                  []proseRule
	tryOneLine, tryAnyLine bool
	limitByParen           bool     // "a parenthesized group followed by another ( is the concurrency limit"
	bodyless               []string // the tokens after which a bodyless declaration continues
	exprStart              map[string]bool
	unread                 []string
}

func newProseSet(a *appendix, g *cfg) *proseSet {
	s := &proseSet{keywords: a.keywords, words: map[string]bool{}, reserved: map[string]map[string]bool{}, rules: a.rules}
	for _, k := range a.keywords {
		for _, w := range k.Words {
			s.words[w] = true
			if k.reference {
				s.reserve("IdentifierReference", w)
			}
		}
		for _, alt := range k.alts {
			if alt == nil && !k.reference && !strings.HasPrefix(k.Phrase, "as TC39") {
				s.unread = append(s.unread, strings.Join(k.Words, ", ")+": "+k.Phrase)
				break
			}
		}
	}
	for _, r := range a.rules {
		switch r.Kind {
		case "reserved":
			for _, w := range backtick.FindAllStringSubmatch(r.Text, 2) {
				for _, class := range []string{"IdentifierReference", "BindingIdentifier", "LabelIdentifier"} {
					s.reserve(class, w[1])
				}
			}
		case "reference":
			for _, w := range backtick.FindAllStringSubmatch(r.Text, 2) {
				s.reserve("IdentifierReference", w[1])
			}
		case "same-line-first":
			s.sameLine = max(s.sameLine, 1)
		case "same-line-all":
			s.sameLine = 2
		case "try-one-line":
			s.tryOneLine = true
		case "try-any-line":
			s.tryAnyLine = true
		case "limit-by-paren":
			s.limitByParen = true
		case "bodyless":
			s.bodyless = []string{"{"}
			if strings.Contains(r.Text, "`<`") {
				s.bodyless = append(s.bodyless, "<")
			}
			if strings.Contains(r.Text, "`extends`") {
				s.bodyless = append(s.bodyless, "extends")
			}
		}
	}
	s.exprStart = map[string]bool{}
	for _, e := range g.named("Expression") {
		for k := range g.first[e] {
			s.exprStart[k] = true
		}
	}
	return s
}

func (s *proseSet) reserve(class, w string) {
	if s.reserved[class] == nil {
		s.reserved[class] = map[string]bool{}
	}
	s.reserved[class][w] = true
}

// readProseRules finds the sentences of Appendix A the search applies.
var proseRuleTexts = []struct {
	kind string
	re   *regexp.Regexp
}{
	{"reserved", regexp.MustCompile("`fork` and `join` are reserved words")},
	{"reference", regexp.MustCompile("`fork` and `join` are keywords where an `IdentifierReference` could stand")},
	{"same-line-first", regexp.MustCompile(`Each one and the token after it are on one line`)},
	{"same-line-all", regexp.MustCompile(`keyword only before the tokens below, on the same line`)},
	{"try-one-line", regexp.MustCompile("(statement that starts with `try \\{`|At the start of a statement, `try \\{` begins)")},
	{"try-any-line", regexp.MustCompile("`try` followed by `\\{`, on the same line or not")},
	{"limit-by-paren", regexp.MustCompile("a parenthesized group followed by another `\\(` is the concurrency limit")},
	{"bodyless", regexp.MustCompile("(The body of an `error` or `schema error` declaration is optional[^\n]*|no body: ends as a TypeScript statement)")},
}

func readProseRules(text string) []proseRule {
	var out []proseRule
	for _, p := range proseRuleTexts {
		if m := p.re.FindString(text); m != "" {
			out = append(out, proseRule{Kind: p.kind, Text: m})
		}
	}
	return out
}

// mark gives each token its keyword state under the table.
func (s *proseSet) mark(toks []token, effect bool, g *cfg) []kwState {
	kw := make([]kwState, len(toks))
	for i, t := range toks {
		if t.kind != 'w' || !s.words[t.text] {
			continue
		}
		state := kwNo
		for _, k := range s.keywords {
			if !containsWord(k.Words, t.text) {
				continue
			}
			if k.effectOnly && !effect {
				continue
			}
			if s.sameLine > 0 && i+1 < len(toks) && toks[i+1].nl && !(len(k.alts) > 0 && k.alts[0] != nil && k.alts[0][0].kind == 'P') {
				continue
			}
			for _, alt := range k.alts {
				if alt == nil || alt[0].kind == 'C' {
					if state == kwNo {
						state = kwBoth
					}
					continue
				}
				if s.matchAlt(alt, toks, i) {
					state = kwYes
				}
			}
		}
		kw[i] = state
	}
	return kw
}

func containsWord(ws []string, w string) bool {
	for _, x := range ws {
		if x == w {
			return true
		}
	}
	return false
}

func (s *proseSet) matchAlt(alt []kwElem, toks []token, i int) bool {
	j := i + 1
	for _, e := range alt {
		if e.kind == 'P' {
			if i == 0 || toks[i-1].text != e.toks[0] {
				return false
			}
			continue
		}
		if j >= len(toks) || s.sameLine == 2 && toks[j].nl {
			return false
		}
		t := toks[j]
		switch e.kind {
		case 't':
			if !containsWord(e.toks, t.text) || t.kind == 's' {
				return false
			}
			j++
		case 'n':
			if t.kind != 'w' || reservedWords[t.text] {
				return false
			}
			j++
		case 'e':
			ok := s.exprStart["t:"+t.text] && t.kind == 'p' || t.kind == 'w' && !reservedWords[t.text] || t.kind == 's' || t.kind == 'n' || t.kind == 't' || reservedWords[t.text] && s.exprStart["t:"+t.text]
			if !ok {
				return false
			}
			j++
		case 'g':
			if t.text != "(" {
				return false
			}
			depth := 0
			for ; j < len(toks); j++ {
				if toks[j].text == "(" {
					depth++
				} else if toks[j].text == ")" {
					depth--
					if depth == 0 {
						break
					}
				}
			}
			if j >= len(toks) {
				return false
			}
			j++
		}
	}
	return true
}

// apply adds the prose rules that are restrictions on the productions'
// symbols to the grammar, active only in prose mode.
func (s *proseSet) apply(g *cfg) {
	defer g.analyze()
	// "(providers and "{" on one line)": no line break between the
	// production's own symbols.
	for name, comments := range g.comments {
		for _, c := range comments {
			if !strings.Contains(c, "on one line") {
				continue
			}
			s.rules = append(s.rules, proseRule{Kind: "one-line", Text: name + ": (" + c + ")"})
			for _, nt := range g.named(name) {
				for _, r := range g.byLHS[nt] {
					rule := &g.rules[r]
					var rhs []gsym
					for k, sym := range rule.rhs {
						if k > 0 {
							rhs = append(rhs, gsym{kind: symNoLT, prose: true})
						}
						rhs = append(rhs, sym)
					}
					rule.rhs = rhs
				}
			}
		}
	}
	// A bodyless error declaration "ends as a TypeScript statement does",
	// unless the next token continues it.
	if len(s.bodyless) > 0 {
		for _, name := range []string{"ErrorDecl", "ErrorDeclaration", "SchemaErrorDecl", "SchemaErrorDeclaration"} {
			for _, nt := range g.named(name) {
				for _, r := range g.byLHS[nt] {
					rule := &g.rules[r]
					last := rule.rhs[len(rule.rhs)-1]
					if last.kind != symNT || !g.helper[last.nt] || !g.nullable[last.nt] {
						continue
					}
					// The body becomes: the body, or nothing, then the end.
					end := g.nt(g.names[last.nt] + "|end")
					g.helper[end] = true
					g.vibe[end] = true
					// The optional body's non-empty alternative is the body itself.
					body := g.rules[g.byLHS[last.nt][0]].rhs
					g.add(end, slices.Clone(body), rule.src, true)
					var seqs [][]string
					for _, t := range s.bodyless {
						seqs = append(seqs, []string{t})
					}
					g.add(end, []gsym{{kind: symNotAhead, seqs: seqs, prose: true}, {kind: symEnd, eff: last.eff}}, rule.src, true)
					rule.rhs[len(rule.rhs)-1] = gsym{kind: symNT, nt: end, text: g.names[end], eff: last.eff}
				}
			}
		}
	}
	if !s.tryOneLine && !s.tryAnyLine {
		return
	}
	for _, es := range g.named("ExpressionStatement") {
		for _, r := range g.byLHS[es] {
			rule := &g.rules[r]
			rule.rhs = append([]gsym{{kind: symNotAhead, seqs: [][]string{{"try", "{"}}, on: !s.tryAnyLine, prose: true}}, rule.rhs...)
		}
	}
}

// keep reports whether a derivation meets the prose rules the parser can't
// check symbol by symbol.
func (s *proseSet) keep(p *earley, t *ptree) bool {
	if t.rule < 0 {
		return true
	}
	name := p.g.base(t.nt)
	switch {
	case s.limitByParen && name == "ForConcurrent" && len(t.kids) > 3:
		// No limit and a body that starts with "(": the prose reads the
		// head as the limit.
		limit := t.kids[2]
		body := t.kids[len(t.kids)-1]
		if limit.i == limit.j && body.i < len(p.toks) && p.toks[body.i].text == "(" {
			return false
		}
	}
	for _, k := range t.kids {
		if !s.keep(p, k) {
			return false
		}
	}
	return true
}

// hasFilters reports whether keep can reject a derivation.
func (s *proseSet) hasFilters() bool {
	return s.limitByParen
}

// reservedAny reports whether effect code reserves a word in any position.
func (s *proseSet) reservedAny(w string) bool {
	for _, ws := range s.reserved {
		if ws[w] {
			return true
		}
	}
	return false
}

package vibelangfuzz

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode"
)

// Appendix A as a context-free grammar. Appendix A writes VibeLang's
// productions in a small notation ("x" a token, X? optional, X* repeated,
// ( … ) a group, | alternatives, [no LineTerminator here], [lookahead ∉ …]
// and [+Effect]) and says that every name it doesn't define is TypeScript's
// or ECMAScript's. The loader reads the productions with the suite's one
// grammar reader (spec_grammar.go) and resolves the other names to
// tsSubset, a compact subset of the ECMAScript 2025 and TypeScript 5.9
// grammars written in the same notation. An alternative written in prose
// ("a Type that is not an unparenthesized EffectType") is a prose terminal:
// the loader lists it with its line, and proseMeanings gives the subset
// production it stands for, or none, which leaves an opaque terminal that
// only matches itself.

type grammarSymKind uint8

const (
	grammarSymNT       grammarSymKind = iota
	grammarSymTok                     // a literal token, such as "catch"
	grammarSymClass                   // a token class: an identifier, a literal or a prose terminal
	grammarSymNoLT                    // [no LineTerminator here]
	grammarSymLT                      // LineTerminator: a line break before the next token
	grammarSymAhead                   // before "}": the next tokens are one of seqs
	grammarSymNotAhead                // [lookahead ∉ { … }]
	grammarSymGuard                   // [+Effect] or [~Effect]
	grammarSymASI                     // the semicolon automatic semicolon insertion supplies
	grammarSymEnd                     // a prose rule's statement end: ";" next, or where ASI would insert one
)

type grammarGsym struct {
	kind      grammarSymKind
	text      string // a nonterminal's name, a token or a class
	nt        int
	seqs      [][]string
	on        bool // [+Effect] rather than [~Effect]; for a lookahead, on one line
	prose     bool // an assertion only Appendix A's prose rules make
	effectArg int8 // explicit [+Effect] or [~Effect] on this nonterminal
	eff       bool // the symbol stands in effect code ([+Effect])
	await     grammarAwaitContext
}

type grammarGrule struct {
	lhs  int
	rhs  []grammarGsym
	src  string // "900-appendices.md:57" for a production, "ts" for the subset
	vibe bool
}

// A grammarProseTerm is an alternative Appendix A writes in words.
type grammarProseTerm struct {
	Name, Text, Meaning string
	Line                int
}

type grammarCfg struct {
	names        []string
	index        map[string]int
	rules        []grammarGrule
	byLHS        [][]int
	ordered      map[int]bool // "(the first that matches)"
	vibe         map[int]bool // nonterminals Appendix A defines
	helper       map[int]bool // nonterminals ?, * and groups introduce
	prose        []grammarProseTerm
	unresolved   []string
	hooks        []string            // "Statement ← ForConcurrent", where the subset admits a production
	comments     map[string][]string // each Appendix A production's comments
	start        int
	startE       int // Script[+Effect]: a sentence as the body of an effect function
	nullable     []bool
	first        []map[string]bool
	minLen       []int
	effectWords  map[string]bool
	fresh        int
	ruleFirst    []map[string]bool
	ruleNullable []bool
}

func (g *grammarCfg) nt(name string) int {
	if i, ok := g.index[name]; ok {
		return i
	}
	g.index[name] = len(g.names)
	g.names = append(g.names, name)
	g.byLHS = append(g.byLHS, nil)
	return len(g.names) - 1
}

func (g *grammarCfg) add(lhs int, rhs []grammarGsym, src string, vibe bool) {
	g.byLHS[lhs] = append(g.byLHS[lhs], len(g.rules))
	g.rules = append(g.rules, grammarGrule{lhs: lhs, rhs: rhs, src: src, vibe: vibe})
}

// grammarTokenClasses are the terminals the notation names in words.
var grammarTokenClasses = map[string]bool{
	"IdentifierReference": true, "BindingIdentifier": true, "LabelIdentifier": true,
	"IdentifierName": true, "StringLiteral": true, "NumericLiteral": true, "TemplateLiteral": true,
	"RegularExpressionLiteral": true,
}

// A grammarNtok is a token of the notation.
type grammarNtok struct {
	kind byte // 'q' "x", 'w' a word, 'b' [ … ], 'p' one of ( ) | ? * +, 'o' anything else
	text string
}

func grammarLexNotation(s string) []grammarNtok {
	var out []grammarNtok
	rs := []rune(s)
	for i := 0; i < len(rs); {
		r := rs[i]
		switch {
		case r == ' ' || r == '\t':
			i++
		case r == '"':
			j := i + 1
			for j < len(rs) && rs[j] != '"' {
				j++
			}
			out = append(out, grammarNtok{'q', string(rs[i+1 : min(j, len(rs))])})
			i = j + 1
		case r == '[':
			// A lookahead may nest [no LineTerminator here], as ECMAScript's
			// ExpressionStatement does; quoted tokens such as "[" don't nest.
			j, depth := i+1, 1
			for ; j < len(rs); j++ {
				if rs[j] == '"' {
					for j++; j < len(rs) && rs[j] != '"'; j++ {
					}
					continue
				}
				if rs[j] == '[' {
					depth++
				} else if rs[j] == ']' {
					if depth--; depth == 0 {
						break
					}
				}
			}
			out = append(out, grammarNtok{'b', string(rs[i+1 : min(j, len(rs))])})
			i = j + 1
		case strings.ContainsRune("()|?*+", r):
			out = append(out, grammarNtok{'p', string(r)})
			i++
		case grammarIsWordRune(r):
			j := i
			for j < len(rs) && (grammarIsWordRune(rs[j]) || rs[j] == '\'' || rs[j] == '’' || rs[j] == '-' || rs[j] == '…') {
				j++
			}
			out = append(out, grammarNtok{'w', string(rs[i:j])})
			i = j
		default:
			out = append(out, grammarNtok{'o', string(r)})
			i++
		}
	}
	return out
}

func grammarIsWordRune(r rune) bool {
	return r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r > 127 && (unicode.IsLetter(r) || unicode.IsDigit(r))
}

func isGrammarName(s string) bool {
	return s != "" && s[0] >= 'A' && s[0] <= 'Z' && !strings.ContainsAny(s, "'’-…")
}

// A notation element is a symbol, a name or a group, with its suffix.
type grammarNelem struct {
	sym       *grammarGsym
	name      string
	alts      [][]grammarNelem
	suffix    byte
	effectArg int8
}

// A grammarNdef is one production as written: its alternatives, their prose and
// the comments after it.
type grammarNdef struct {
	name     string
	alts     [][]grammarNelem
	prose    []string // alternatives written in words, by index of alts (nil elements)
	comments []string
	line     int
	vibe     bool
	source   string // pinned external proposal, when not an Appendix A production
}

// grammarSplitAlts splits a production body at its top-level "|".
func grammarSplitAlts(body string) []string {
	var alts []string
	depth, start, brackets := 0, 0, 0
	inQuote := false
	rs := []rune(body)
	for i, r := range rs {
		switch {
		case inQuote:
			inQuote = r != '"'
		case r == '"':
			// A quoted token, inside a lookahead set too: `"]"` and `"|"` are members.
			inQuote = true
		case r == '[':
			brackets++
		case r == ']' && brackets > 0:
			brackets--
		case brackets > 0:
		case r == '(':
			depth++
		case r == ')':
			depth--
		case r == '|' && depth == 0:
			alts = append(alts, string(rs[start:i]))
			start = i + 1
		}
	}
	return append(alts, string(rs[start:]))
}

// grammarCommentGroup reports whether the group toks[i:j] (inside parentheses) is
// a comment: it holds anything but tokens, names and the notation.
func grammarCommentGroup(toks []grammarNtok) bool {
	for _, t := range toks {
		switch t.kind {
		case 'w':
			if !isGrammarName(t.text) {
				return true
			}
		case 'o':
			return true
		}
	}
	return false
}

// grammarParseDef reads one production body. Parenthesized comments are kept as
// comments; an alternative with words outside them is prose.
func grammarParseDef(name, body string, line int) grammarNdef {
	d := grammarNdef{name: name, line: line}
	for _, raw := range grammarSplitAlts(body) {
		toks := grammarLexNotation(raw)
		var kept []grammarNtok
		for i := 0; i < len(toks); i++ {
			if toks[i].kind == 'p' && toks[i].text == "(" {
				depth, j := 0, i
				for ; j < len(toks); j++ {
					if toks[j].kind == 'p' && toks[j].text == "(" {
						depth++
					} else if toks[j].kind == 'p' && toks[j].text == ")" {
						depth--
						if depth == 0 {
							break
						}
					}
				}
				if j >= len(toks) {
					j = len(toks) - 1
				}
				if grammarCommentGroup(toks[i+1 : j]) {
					d.comments = append(d.comments, strings.TrimSpace(grammarJoinNotation(toks[i+1:j])))
					i = j
					continue
				}
			}
			kept = append(kept, toks[i])
		}
		prose := false
		for i, t := range kept {
			if t.kind == 'o' || t.kind == 'w' && !isGrammarName(t.text) && !(t.text == "before" && i+1 < len(kept) && kept[i+1].kind == 'q') {
				prose = true
			}
		}
		if prose {
			d.alts = append(d.alts, nil)
			d.prose = append(d.prose, strings.TrimSpace(raw))
			continue
		}
		elems, _ := grammarParseElems(kept, 0)
		d.alts = append(d.alts, elems...)
		d.prose = append(d.prose, make([]string, len(elems))...)
	}
	return d
}

func grammarJoinNotation(toks []grammarNtok) string {
	var b strings.Builder
	for i, t := range toks {
		if i > 0 && t.kind != 'p' || i > 0 && t.text == "(" {
			b.WriteByte(' ')
		}
		switch t.kind {
		case 'q':
			b.WriteString(`"` + t.text + `"`)
		case 'b':
			b.WriteString("[" + t.text + "]")
		default:
			b.WriteString(t.text)
		}
	}
	return b.String()
}

// grammarParseElems parses alternatives until a closing parenthesis; it returns
// the alternatives and the index after them.
func grammarParseElems(toks []grammarNtok, i int) ([][]grammarNelem, int) {
	alts := [][]grammarNelem{nil}
	for i < len(toks) {
		t := toks[i]
		var e grammarNelem
		switch {
		case t.kind == 'p' && t.text == ")":
			return alts, i + 1
		case t.kind == 'p' && t.text == "|":
			alts = append(alts, nil)
			i++
			continue
		case t.kind == 'p' && t.text == "(":
			var sub [][]grammarNelem
			sub, i = grammarParseElems(toks, i+1)
			e = grammarNelem{alts: sub}
		case t.kind == 'q':
			e = grammarNelem{sym: &grammarGsym{kind: grammarSymTok, text: t.text}}
			i++
		case t.kind == 'b':
			e = grammarNelem{sym: grammarBracketSym(t.text)}
			i++
		case t.kind == 'w' && t.text == "before" && i+1 < len(toks) && toks[i+1].kind == 'q':
			e = grammarNelem{sym: &grammarGsym{kind: grammarSymAhead, seqs: [][]string{{toks[i+1].text}}}}
			i += 2
		case t.kind == 'w':
			e = grammarNelem{name: t.text}
			i++
			if i < len(toks) && toks[i].kind == 'b' {
				if arg, ok := grammarEffectArgument(toks[i].text); ok {
					e.effectArg = arg
					i++
				}
			}
		default:
			i++
			continue
		}
		if i < len(toks) && toks[i].kind == 'p' && strings.Contains("?*+", toks[i].text) {
			e.suffix = toks[i].text[0]
			i++
		}
		alts[len(alts)-1] = append(alts[len(alts)-1], e)
	}
	return alts, i
}

var grammarNotationQuoted = regexp.MustCompile(`"([^"]*)"`)

// grammarNoLTMark stands in a lookahead sequence for [no LineTerminator here]
// between two of its tokens; it matches no token.
const grammarNoLTMark = "\n"

var grammarLookaheadElem = regexp.MustCompile(`"([^"]*)"|\[no LineTerminator here\]`)

// grammarBracketSym reads an ECMAScript restriction or a grammar parameter.
func grammarBracketSym(text string) *grammarGsym {
	t := strings.TrimSpace(text)
	switch {
	case t == "no LineTerminator here":
		return &grammarGsym{kind: grammarSymNoLT}
	case t == "+Effect" || t == "~Effect":
		return &grammarGsym{kind: grammarSymGuard, on: t == "+Effect"}
	case strings.HasPrefix(t, "lookahead ∉") || strings.HasPrefix(t, "lookahead ≠") || strings.HasPrefix(t, "lookahead ∈") || strings.HasPrefix(t, "lookahead ="):
		// The operator follows "lookahead "; an "=" later on belongs to a token
		// in the set, such as "=>".
		operator, set := "", strings.TrimPrefix(t, "lookahead ")
		for _, op := range []string{"∉", "≠", "∈", "="} {
			if rest, ok := strings.CutPrefix(set, op); ok {
				operator, set = op, rest
				break
			}
		}
		kind := grammarSymNotAhead
		if operator == "∈" || operator == "=" {
			kind = grammarSymAhead
		}
		set = strings.TrimSpace(set)
		set = strings.TrimSuffix(strings.TrimPrefix(set, "{"), "}")
		var seqs [][]string
		for _, part := range grammarSplitLookahead(set) {
			var seq []string
			for _, m := range grammarLookaheadElem.FindAllStringSubmatch(part, -1) {
				if m[0] == "[no LineTerminator here]" {
					seq = append(seq, grammarNoLTMark)
					continue
				}
				seq = append(seq, m[1])
			}
			if len(seq) > 0 {
				seqs = append(seqs, seq)
			}
		}
		return &grammarGsym{kind: kind, seqs: seqs}
	}
	return &grammarGsym{kind: grammarSymClass, text: "‹[" + t + "]›"}
}

// grammarSemicolonInsertion reads each ";" token of the alternatives as the
// subset's StatementEnd, which ASI may supply.
func grammarSemicolonInsertion(alts [][]grammarNelem) {
	for _, alt := range alts {
		for i := range alt {
			if alt[i].sym != nil && alt[i].sym.kind == grammarSymTok && alt[i].sym.text == ";" {
				alt[i] = grammarNelem{name: "StatementEnd", suffix: alt[i].suffix}
			}
			grammarSemicolonInsertion(alt[i].alts)
		}
	}
}

// grammarSplitLookahead splits a lookahead set at the commas between its
// members. A quoted "," is a member, as in ThrowExpressionInvalidPunctuator.
func grammarSplitLookahead(set string) []string {
	var parts []string
	quoted, start := false, 0
	for i, r := range set {
		switch {
		case r == '"':
			quoted = !quoted
		case r == ',' && !quoted:
			parts = append(parts, set[start:i])
			start = i + 1
		}
	}
	return append(parts, set[start:])
}

// grammarTsSubset is the TypeScript the search embeds: ECMAScript 2025's
// statements and expressions and TypeScript 5.9's types, cut to what the
// VibeLang productions and the specification's examples touch (regular-expression literals validated independently,
// templates as one token, no JSX, no decorators). Each rule is ECMAScript's or
// TypeScript's own, with four liberties: helper names; ASI as an explicit
// symbol (see earley); the restrictions the TypeScript parser puts on line
// breaks (before "as", "!", "[]" and after a modifier, "readonly" in a
// type member included); and lookaheads for
// the choices TypeScript's parser makes greedily, where the written grammar
// has two readings: a type after "as" takes a following "|" or "&", and a
// type name takes a following "<" as its type arguments, and "(" … ")"
// followed by "=>" is a function type. An instantiation expression `f<T>`
// stands where TypeScript's canFollowTypeArgumentsInExpression allows it: before
// a line break or the end of the file, a binary operator (not < > + -) or a
// token that starts no expression. A keyword type takes no type arguments, and
// a type name takes none across a line break, so "<" there is relational.
// TypeScript reports nothing after a bare `declare` identifier expression
// (parseErrorForMissingSemicolonAfter assumes a declaration diagnostic was
// already given), so `declare x: number` is `declare` and then `x: number` on
// one line; DeclareExpressionStatement writes that reading.
// TypeScript's checker reports an empty type parameter list (TS1098) only on
// a function or a class (checkGrammarTypeParameterList), so a type alias or
// an interface may write `<>`; DeclarationTypeParameters admits it there.
// The lexer never joins `<` or `>` pairs, so the shift operators and their
// compound assignments are token sequences (`"<" "<"`, `">" ">" ">="`); unlike
// TypeScript's rescanning of an adjacent `>`, they also read a spaced `> >`,
// which only widens what derives.
// "{ p = 1 }" is ECMAScript's CoverInitializedName, written only as an assignment
// target so an object literal still has no initializer. TypeScript's parser keeps its binary
// loop going after "as T" or "satisfies T", so any operator may follow one:
// `x as number % 2` is `(x as number) % 2`. The subset puts both on
// UpdateExpression, which derives the same sentences. A statement may end before
// a new-line block even if a competing relational reading could scan an object
// literal there: TypeScript has already selected the instantiation reading (see
// the Earley ASI boundary).
// Script is the start symbol.
const grammarTsSubset = `
Script = ScriptItem*
ScriptItem = Statement
Statement = Block | VariableStatement | EmptyStatement | ExpressionStatement | IfStatement | WhileStatement | ForOfStatement | ForStatement | ForInStatement | SwitchStatement | ReturnStatement | ThrowStatement | TryStatement | LabelledStatement | BreakStatement | ContinueStatement | Declaration | DoWhileStatement | DeclareExpressionStatement
SwitchStatement = "switch" "(" Expression ")" "{" CaseClause* "}"
CaseClause = "case" Expression ":" Statement* | "default" ":" Statement*
Declaration = HoistableDeclaration | ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration | ImportDeclaration | ImportEqualsDeclaration | ExportDeclaration | "declare" [no LineTerminator here] DeclareDeclaration | "abstract" [no LineTerminator here] ClassDeclaration | NamespaceDeclaration | EnumDeclaration
DeclareDeclaration = VariableStatement | FunctionDeclaration | ClassDeclaration | "abstract" [no LineTerminator here] ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration | NamespaceDeclaration | EnumDeclaration | "module" StringLiteral "{" ModuleBody? "}" | "module" StringLiteral StatementEnd | "global" "{" ModuleBody? "}"
NamespaceDeclaration = "namespace" [no LineTerminator here] TypeName "{" ModuleBody? "}"
EnumDeclaration = "const"? "enum" BindingIdentifier "{" "}" | "const"? "enum" BindingIdentifier "{" EnumMemberList ","? "}"
EnumMemberList = EnumMember | EnumMemberList "," EnumMember
EnumMember = PropertyName Initializer?
HoistableDeclaration = FunctionDeclaration
Block = "{" Statement* "}"
FunctionBody = Statement*
VariableStatement = LetOrConst BindingList StatementEnd | "using" [no LineTerminator here] BindingList StatementEnd
LetOrConst = "const" | "let" | "var"
BindingList = LexicalBinding | BindingList "," LexicalBinding
LexicalBinding = BindingIdentifier TypeAnnotation? Initializer? | BindingPattern TypeAnnotation? Initializer
Initializer = "=" AssignmentExpression
BindingPattern = ObjectBindingPattern | ArrayBindingPattern
ObjectBindingPattern = "{" "}" | "{" BindingRestProperty "}" | "{" BindingPropertyList "}" | "{" BindingPropertyList "," "}" | "{" BindingPropertyList "," BindingRestProperty "}"
ArrayBindingPattern = "[" BindingElision? BindingRestElement? "]" | "[" BindingElementList "]" | "[" BindingElementList "," BindingElision? BindingRestElement? "]"
BindingRestProperty = "..." BindingIdentifier
BindingPropertyList = BindingProperty | BindingPropertyList "," BindingProperty
BindingProperty = BindingIdentifier Initializer? | PropertyName ":" BindingElement
BindingElementList = BindingElisionElement | BindingElementList "," BindingElisionElement
BindingElisionElement = BindingElision? BindingElement
BindingElement = BindingIdentifier Initializer? | BindingPattern Initializer?
BindingRestElement = "..." BindingIdentifier | "..." BindingPattern
BindingElision = "," | BindingElision ","
EmptyStatement = ";"
ExpressionStatement = [lookahead ∉ { "{", "function", "class", "let" "[", "async" [no LineTerminator here] "function", "effect" [no LineTerminator here] "function", "do", "throw" }] Expression StatementEnd
StatementEnd = ";" | ASI
IfStatement = "if" "(" Expression ")" Statement "else" Statement | "if" "(" Expression ")" Statement [lookahead ∉ { "else" }]
WhileStatement = "while" "(" Expression ")" Statement
DoWhileStatement = "do" Statement "while" "(" Expression ")" ";"?
DeclareExpressionStatement = "declare" [no LineTerminator here] [lookahead ∉ { "(", "[", ".", "?.", "!", ",", ";", "=>", "?", ":", "=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "&&=", "||=", "??=", "+", "-", "*", "/", "%", "**", "<", ">", "<=", ">=", "==", "!=", "===", "!==", "&&", "||", "??", "&", "|", "^", "++", "--", "as", "satisfies", "is", "in", "instanceof", "|>", "catch" }] Statement
ForOfStatement = "for" "(" ForOfHead "of" AssignmentExpression ")" Statement | "for" "await" "(" ForAwaitOfHead "of" AssignmentExpression ")" Statement
ForStatement = "for" "(" [lookahead ∉ { "let" "[" }] Expression? ";" Expression? ";" Expression? ")" Statement | "for" "(" LetOrConst BindingList ";" Expression? ";" Expression? ")" Statement
ForInStatement = "for" "(" ForOfHead "in" Expression ")" Statement
ForDeclaration = LetOrConst ForBinding
ForBinding = BindingIdentifier | BindingPattern
ForOfHead = LetOrConst BindingIdentifier | LetOrConst BindingPattern | [lookahead ∉ { "let", "async" "of" }] ForAssignmentTarget | "using" [no LineTerminator here] BindingIdentifier | "await" "using" [no LineTerminator here] BindingIdentifier
ForAwaitOfHead = LetOrConst BindingIdentifier | LetOrConst BindingPattern | [lookahead ≠ "let"] ForAssignmentTarget | "using" [no LineTerminator here] BindingIdentifier | "await" "using" [no LineTerminator here] BindingIdentifier
ForAssignmentTarget = ForAssignmentTargetBase | ForAssignmentTarget [no LineTerminator here] "as" Type | ForAssignmentTarget [no LineTerminator here] "satisfies" Type
ForAssignmentTargetBase = LeftHandSideExpression | "<" Type ">" ForAssignmentTargetBase
ReturnStatement = "return" StatementEnd | "return" [no LineTerminator here] Expression StatementEnd
ThrowStatement = "throw" [no LineTerminator here] Expression StatementEnd
TryStatement = "try" Block Catch | "try" Block Finally | "try" Block Catch Finally
Catch = "catch" "(" BindingIdentifier TypeAnnotation? ")" Block | "catch" "(" BindingPattern TypeAnnotation? ")" Block | "catch" Block
Finally = "finally" Block
LabelledStatement = LabelIdentifier ":" Statement
BreakStatement = "break" StatementEnd | "break" [no LineTerminator here] LabelIdentifier StatementEnd
ContinueStatement = "continue" StatementEnd | "continue" [no LineTerminator here] LabelIdentifier StatementEnd
FunctionDeclaration = "function" "*"? BindingIdentifier TypeParameters? "(" FormalParameters ")" ReturnAnnotation? (Block | StatementEnd) | "async" [no LineTerminator here] "function" "*"? BindingIdentifier TypeParameters? "(" FormalParameters ")" ReturnAnnotation? (Block | StatementEnd)
ClassDeclaration = "class" BindingIdentifier TypeParameters? ClassHeritage? "{" ClassElement* "}"
ClassHeritage = "extends" LeftHandSideExpression | "extends" LeftHandSideExpression [no LineTerminator here] TypeArguments | "implements" TypeList | "extends" LeftHandSideExpression "implements" TypeList | "extends" LeftHandSideExpression [no LineTerminator here] TypeArguments "implements" TypeList
ClassElement = ClassMemberModifiers? MethodDefinition | ClassMemberModifiers? OptionalClassMethod | FieldDefinition | "static" Block | ";" | ClassMemberModifiers? IndexSignature StatementEnd
OptionalClassMethod = "*" PropertyName "?" TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block | "async" [no LineTerminator here] "*" PropertyName "?" TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block | "async" [no LineTerminator here] PropertyName "?" TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block | "*" PropertyName "?" TypeParameters? "(" FormalParameters ")" ReturnAnnotation? StatementEnd | "async" [no LineTerminator here] "*" PropertyName "?" TypeParameters? "(" FormalParameters ")" ReturnAnnotation? StatementEnd | "async" [no LineTerminator here] PropertyName "?" TypeParameters? "(" FormalParameters ")" ReturnAnnotation? StatementEnd
ClassMemberModifiers = ClassMemberModifier | ClassMemberModifiers ClassMemberModifier
ClassMemberModifier = "static" | "readonly" [no LineTerminator here] | "public" [no LineTerminator here] | "private" [no LineTerminator here] | "protected" [no LineTerminator here] | "override" [no LineTerminator here] | "abstract" [no LineTerminator here] | "declare" [no LineTerminator here] | "accessor" [no LineTerminator here]
FieldDefinition = ClassMemberModifiers? PropertyName "?"? TypeAnnotation? Initializer? StatementEnd | ClassMemberModifiers? PropertyName [no LineTerminator here] "!" TypeAnnotation? Initializer? StatementEnd | ClassMemberModifiers? PropertyName "?"? TypeAnnotation? "=" "throw" UnaryExpression LineTerminator [lookahead ∈ { "*" }]
MethodDefinition = PropertyName "?"? TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block | "*" PropertyName TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block | "async" [no LineTerminator here] "*" PropertyName TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block | PropertyName "?"? TypeParameters? "(" FormalParameters ")" ReturnAnnotation? StatementEnd | GetAccessor | "set" PropertyName "(" FormalParameter ")" Block | "async" [no LineTerminator here] PropertyName "(" FormalParameters ")" ReturnAnnotation? Block
GetAccessor = "get" PropertyName "(" ")" ReturnAnnotation? Block
NonStaticMethod = PropertyName "?"? TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block | "async" [no LineTerminator here] PropertyName "(" FormalParameters ")" ReturnAnnotation? Block
InterfaceDeclaration = "interface" BindingIdentifier DeclarationTypeParameters? InterfaceExtends? ObjectType
InterfaceExtends = "extends" TypeReference | InterfaceExtends "," TypeReference
TypeAliasDeclaration = "type" [no LineTerminator here] BindingIdentifier DeclarationTypeParameters? "=" Type StatementEnd
ImportDeclaration = "import" ImportClause "from" StringLiteral StatementEnd | "import" StringLiteral StatementEnd
TsImportDeclaration = "import" ImportClause "from" ModuleSpecifier StatementEnd | "import" ModuleSpecifier StatementEnd
ImportEqualsDeclaration = "import" BindingIdentifier "=" ModuleReference StatementEnd | "import" "type" BindingIdentifier "=" ModuleReference StatementEnd
ModuleReference = "require" "(" StringLiteral ")" | TypeName
ModuleBody = Statement | ModuleBody Statement
ImportClause = BindingIdentifier | NamespaceImport | NamedImports | BindingIdentifier "," NamespaceImport | BindingIdentifier "," NamedImports | "type" BindingIdentifier | "type" NamespaceImport | "type" NamedImports
NamespaceImport = "*" "as" BindingIdentifier
NamedImports = "{" "}" | "{" ImportsList ","? "}"
ImportsList = ImportSpecifier | ImportsList "," ImportSpecifier
ImportSpecifier = BindingIdentifier | ModuleExportName "as" BindingIdentifier | "type" BindingIdentifier | "type" ModuleExportName "as" BindingIdentifier
ExportDeclaration = ReExportDeclaration | "export" VariableStatement | "export" HoistableDeclaration | "export" ClassDeclaration | "export" InterfaceDeclaration | "export" TypeAliasDeclaration | "export" ImportEqualsDeclaration | "export" "type"? NamedExports StatementEnd | "export" "default" DefaultExportDeclaration | "export" "default" [lookahead ∉ { "function", "class", "async" [no LineTerminator here] "function" }] AssignmentExpression StatementEnd | "export" "declare" [no LineTerminator here] DeclareDeclaration | "export" "abstract" [no LineTerminator here] ClassDeclaration | "export" NamespaceDeclaration | "export" EnumDeclaration | "export" "default" "abstract" [no LineTerminator here] ClassDeclaration
DefaultExportDeclaration = FunctionExpression | GeneratorExpression | AsyncFunctionExpression | AsyncGeneratorExpression | ClassExpression
ReExportDeclaration = "export" "type"? ExportFromClause "from" StringLiteral StatementEnd
ExportFromClause = "*" | "*" "as" IdentifierName | NamedExports
NamedExports = "{" "}" | "{" ExportSpecifiers ","? "}"
ExportSpecifiers = ExportSpecifier | ExportSpecifiers "," ExportSpecifier
ExportSpecifier = ModuleExportName | ModuleExportName "as" ModuleExportName | "type" ModuleExportName | "type" ModuleExportName "as" ModuleExportName
ModuleExportName = IdentifierName | StringLiteral
Expression = AssignmentExpression | Expression "," AssignmentExpression
AssignmentExpression = ConditionalExpression | ArrowFunction | AsyncArrowFunction | YieldExpression | LeftHandSideExpression "=" AssignmentExpression | ObjectAssignmentPattern "=" AssignmentExpression | LeftHandSideExpression AssignmentOperator AssignmentExpression
AssignmentOperator = "*=" | "/=" | "%=" | "+=" | "-=" | "&=" | "^=" | "|=" | "**=" | "&&=" | "||=" | "??=" | "<" "<=" | ">" ">=" | ">" ">" ">="
ConditionalExpression = ShortCircuitExpression | ShortCircuitExpression "?" AssignmentExpression ":" AssignmentExpression
ShortCircuitExpression = LogicalORExpression | CoalesceExpression
CoalesceExpression = CoalesceExpressionHead "??" BitwiseORExpression
CoalesceExpressionHead = CoalesceExpression | BitwiseORExpression
LogicalORExpression = LogicalANDExpression | LogicalORExpression "||" LogicalANDExpression
LogicalANDExpression = BitwiseORExpression | LogicalANDExpression "&&" BitwiseORExpression
BitwiseORExpression = BitwiseXORExpression | BitwiseORExpression "|" BitwiseXORExpression
BitwiseXORExpression = BitwiseANDExpression | BitwiseXORExpression "^" BitwiseANDExpression
BitwiseANDExpression = EqualityExpression | BitwiseANDExpression "&" EqualityExpression
EqualityExpression = RelationalExpression | EqualityExpression EqualityOperator RelationalExpression
EqualityOperator = "===" | "!==" | "==" | "!="
RelationalExpression = ShiftExpression | RelationalExpression RelationalOperator ShiftExpression
RelationalOperator = "<" | ">" | "<=" | ">=" | "instanceof" | "in"
ShiftExpression = AdditiveExpression | ShiftExpression ShiftOperator AdditiveExpression
ShiftOperator = "<" "<" | ">" ">" | ">" ">" ">"
AdditiveExpression = MultiplicativeExpression | AdditiveExpression "+" MultiplicativeExpression | AdditiveExpression "-" MultiplicativeExpression
MultiplicativeExpression = ExponentiationExpression | MultiplicativeExpression MultiplicativeOperator ExponentiationExpression
MultiplicativeOperator = "*" | "/" | "%"
ExponentiationExpression = UnaryExpression | UpdateExpression "**" ExponentiationExpression
UnaryExpression = "<" Type ">" UnaryExpression | UpdateExpression | "!" UnaryExpression | "-" UnaryExpression | "+" UnaryExpression | "typeof" UnaryExpression | "void" UnaryExpression | "delete" UnaryExpression | AwaitExpression
AwaitExpression = "await" UnaryExpression
YieldExpression = "yield" [lookahead ∉ { "*" }] | "yield" [no LineTerminator here] AssignmentExpression | "yield" [no LineTerminator here] "*" AssignmentExpression
UpdateExpression = LeftHandSideExpression | LeftHandSideExpression [no LineTerminator here] "++" | "++" UnaryExpression | UpdateExpression [no LineTerminator here] "as" Type [lookahead ∉ { "|", "&" }] | UpdateExpression [no LineTerminator here] "satisfies" Type [lookahead ∉ { "|", "&" }] | LeftHandSideExpression [no LineTerminator here] "--" | "--" UnaryExpression
LeftHandSideExpression = NewExpression | CallExpression | OptionalExpression
NewExpression = MemberExpression | "new" NewExpression
MemberExpression = MemberExpression TypeArguments LineTerminator [lookahead ∉ { "<", ">", "+", "-" }] | MemberExpression TypeArguments [lookahead ∈ { ";", ")", "]", "}", ",", ":", "?", "??", "||", "&&", "|", "&", "^", "==", "!=", "===", "!==", "<=", ">=", "*", "/", "%", "**", "<<", ">>", ">>>", "instanceof", "in", "as", "satisfies", "=", "+=", "-=", "??=" }] | MetaProperty | PrimaryExpression | "super" "." IdentifierName | "super" "[" Expression "]" | MemberExpression "[" Expression "]" | MemberExpression "." IdentifierName | MemberExpression [no LineTerminator here] "!" | MemberExpression TemplateLiteral | "new" MemberExpression Arguments | "new" MemberExpression TypeArguments Arguments
MetaProperty = "import" "." "meta" | "new" "." "target"
CallExpression = ImportCall | MemberExpression Arguments | "super" Arguments | CallExpression Arguments | CallExpression "[" Expression "]" | CallExpression "." IdentifierName | CallExpression [no LineTerminator here] "!" | MemberExpression TypeArguments Arguments | CallExpression TypeArguments Arguments
ImportCall = "import" "(" AssignmentExpression ","? ")" | "import" "(" AssignmentExpression "," AssignmentExpression ","? ")"
OptionalExpression = MemberExpression OptionalChain | CallExpression OptionalChain | OptionalExpression OptionalChain
OptionalChain = "?." IdentifierName | "?." Arguments | "?." "[" Expression "]" | "?." TypeArguments Arguments | OptionalChain "." IdentifierName | OptionalChain "[" Expression "]" | OptionalChain Arguments | OptionalChain TemplateLiteral | OptionalChain [no LineTerminator here] "!"
Arguments = "(" ")" | "(" ArgumentList ","? ")"
ArgumentList = AssignmentExpression | "..." AssignmentExpression | ArgumentList "," AssignmentExpression | ArgumentList "," "..." AssignmentExpression
PrimaryExpression = "this" | IdentifierReference | Literal | RegularExpressionLiteral | ArrayLiteral | ObjectLiteral | FunctionExpression | GeneratorExpression | AsyncFunctionExpression | AsyncGeneratorExpression | ClassExpression | TemplateLiteral | ParenthesizedExpression
Literal = "null" | "true" | "false" | NumericLiteral | StringLiteral
ArrayLiteral = "[" ArrayElision? "]" | "[" ArrayElision? ElementList "]" | "[" ArrayElision? ElementList "," ArrayElision? "]"
ArrayElision = "," | ArrayElision ","
ElementList = ArrayItem | ElementList "," ArrayElision? ArrayItem
ArrayItem = AssignmentExpression | "..." AssignmentExpression
ObjectLiteral = "{" "}" | "{" PropertyDefinitionList ","? "}"
ObjectAssignmentPattern = "{" ObjectPatternHead? CoverInitializedName ObjectPatternTail* ","? "}"
ObjectPatternHead = PropertyDefinition "," | ObjectPatternHead PropertyDefinition ","
ObjectPatternTail = "," PropertyDefinition | "," CoverInitializedName
CoverInitializedName = IdentifierReference Initializer
PropertyDefinitionList = PropertyDefinition | PropertyDefinitionList "," PropertyDefinition
PropertyDefinition = IdentifierReference | PropertyName ":" AssignmentExpression | MethodDefinition | "..." AssignmentExpression
PropertyName = IdentifierName | StringLiteral | NumericLiteral | "[" AssignmentExpression "]"
FunctionExpression = "function" BindingIdentifier? TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block
ClassExpression = "class" BindingIdentifier? TypeParameters? ClassHeritage? "{" ClassElement* "}"
ParenthesizedExpression = "(" Expression ")"
ArrowFunction = ArrowParameters [no LineTerminator here] "=>" ConciseBody | TypeParameters? "(" FormalParameters ")" ReturnAnnotation [no LineTerminator here] "=>" ConciseBody | TypeParameters "(" FormalParameters ")" [no LineTerminator here] "=>" ConciseBody | TypeParameters? "(" FormalParameters ")" ":" "(" Type ")" [no LineTerminator here] "=>" ConciseBody
ArrowParameters = BindingIdentifier | "(" FormalParameters ")"
AsyncArrowFunction = "async" [no LineTerminator here] ArrowParameters [no LineTerminator here] "=>" ConciseBody | "async" [no LineTerminator here] "(" FormalParameters ")" ReturnAnnotation [no LineTerminator here] "=>" ConciseBody | "async" [no LineTerminator here] "(" FormalParameters ")" ":" "(" Type ")" [no LineTerminator here] "=>" ConciseBody
ConciseBody = [lookahead ∉ { "{" }] AssignmentExpression | Block
FormalParameters = FormalParameterList? | FormalParameterList ","
FormalParameterList = FormalParameter | "this" TypeAnnotation | FormalParameterList "," FormalParameter
FormalParameter = ParameterModifiers? BindingIdentifier "?"? TypeAnnotation? Initializer? | BindingPattern "?"? TypeAnnotation? Initializer? | "..." BindingIdentifier TypeAnnotation? | "..." BindingPattern TypeAnnotation?
ParameterModifier = "readonly" [no LineTerminator here] | "public" [no LineTerminator here] | "private" [no LineTerminator here] | "protected" [no LineTerminator here]
ParameterModifiers = ParameterModifier | ParameterModifiers ParameterModifier
TypeAnnotation = ":" Type
ReturnType = ":" Type | ":" TypePredicate
ReturnAnnotation = ":" Type | ":" TypePredicate
TypePredicate = IdentifierReference [no LineTerminator here] "is" Type | "this" [no LineTerminator here] "is" Type | "asserts" [no LineTerminator here] IdentifierReference | "asserts" [no LineTerminator here] "this" | "asserts" [no LineTerminator here] IdentifierReference "is" Type | "asserts" [no LineTerminator here] "this" "is" Type
TypeParameters = "<" TypeParameterList ","? ">"
DeclarationTypeParameters = TypeParameters | "<" ">"
TypeParameterList = TypeParameter | TypeParameterList "," TypeParameter
TypeParameter = "const"? BindingIdentifier | "const"? BindingIdentifier "extends" Type | "const"? BindingIdentifier "=" Type | "const"? BindingIdentifier "extends" Type "=" Type
TypeArguments = "<" TypeList ">"
TypeList = Type | TypeList "," Type
Type = UnionType | FunctionType | ConstructorType | ConditionalType
TypeNoEffect = UnionType | FunctionType | ConstructorType | ConditionalType
ConditionalType = UnionType "extends" Type "?" Type ":" Type
ConstructorType = "abstract"? "new" TypeParameters? "(" FormalParameters ")" "=>" Type
UnionType = "|"? IntersectionType | UnionType "|" IntersectionType
IntersectionType = "&"? PostfixType | IntersectionType "&" PostfixType
PostfixType = PrimaryType | PostfixType [no LineTerminator here] "[" "]" | PostfixType [no LineTerminator here] "[" Type "]" | "readonly" PostfixType | "keyof" PostfixType | "infer" BindingIdentifier | "infer" BindingIdentifier "extends" Type | "unique" PostfixType
PrimaryType = TypeReference | "(" Type ")" [lookahead ∉ { "=>" }] | ObjectType | TupleType | StringLiteral | NumericLiteral | "void" | "null" | "true" | "false" | "typeof" TypeQueryName | "typeof" TypeQueryName [no LineTerminator here] TypeArguments | "typeof" ImportType | ImportType | "this" | "-" NumericLiteral | MappedType
TypeQueryName = IdentifierReference | "this" | TypeQueryName "." IdentifierName
ImportType = "import" "(" StringLiteral ")" | "import" "(" StringLiteral ")" "." TypeName | ImportType [no LineTerminator here] TypeArguments
MappedType = "{" MappedReadonly? "[" IdentifierName "in" Type "]" MappedOptional? TypeAnnotation? TypeMemberEnd? "}" | "{" MappedReadonly? "[" IdentifierName "in" Type "as" Type "]" MappedOptional? TypeAnnotation? TypeMemberEnd? "}"
MappedReadonly = "readonly" | "+" "readonly" | "-" "readonly"
MappedOptional = "?" | "+" "?" | "-" "?"
TypeReference = TypeName [lookahead ∉ { "<" }] | TypeName [no LineTerminator here] TypeArguments | TypeName LineTerminator [lookahead ∈ { "<" }] | KeywordType [lookahead ∈ { "<" }]
KeywordType = "any" | "unknown" | "never" | "number" | "bigint" | "boolean" | "string" | "symbol" | "undefined" | "object"
TypeName = IdentifierName | TypeName "." IdentifierName
TupleType = "[" "]" | "[" TupleElementList ","? "]"
TupleElementList = TupleElement | TupleElementList "," TupleElement
TupleElement = Type | Type [no LineTerminator here] "?" | IdentifierName "?"? ":" Type | "..." Type | "..." IdentifierName ":" Type
FunctionType = TypeParameters? "(" FormalParameters ")" "=>" Type | TypeParameters? "(" FormalParameters ")" "=>" TypePredicate
ObjectType = "{" "}" | "{" TypeMemberList TypeMemberEnd? "}"
TypeMemberList = TypeMember | TypeMemberList TypeMemberSeparator TypeMember
TypeMemberSeparator = ";" | "," | LineTerminator
TypeMemberEnd = ";" | ","
TypeMember = PropertySignature | MethodSignature | CallSignature | GetAccessorSignature | SetAccessorSignature | IndexSignature
IndexSignature = "[" IdentifierName TypeAnnotation "]" TypeAnnotation | "readonly" [no LineTerminator here] "[" IdentifierName TypeAnnotation "]" TypeAnnotation
GetAccessorSignature = "get" PropertyName "(" ")" ReturnAnnotation?
SetAccessorSignature = "set" PropertyName "(" FormalParameter ")"
CallSignature = TypeParameters? "(" FormalParameters ")" ReturnAnnotation?
RejectedMemberShape = ClassMemberModifiers? MethodDefinition | ClassMemberModifiers? PropertyName "?"? TypeAnnotation? Initializer? | CallSignature | ClassMemberModifiers? PropertyName [no LineTerminator here] "!" TypeAnnotation? Initializer? | IndexSignature | "new" CallSignature
PropertySignature = PropertyName "?"? TypeAnnotation? | "readonly" [no LineTerminator here] PropertyName "?"? TypeAnnotation?
MethodSignature = PropertyName "?"? TypeParameters? "(" FormalParameters ")" ReturnAnnotation?
ClassElementName = PropertyName | "#" IdentifierName
GeneratorExpression = "function" "*" BindingIdentifier? TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block
AsyncFunctionExpression = "async" [no LineTerminator here] "function" BindingIdentifier? TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block
AsyncGeneratorExpression = "async" [no LineTerminator here] "function" "*" BindingIdentifier? TypeParameters? "(" FormalParameters ")" ReturnAnnotation? Block
Name = BindingIdentifier
`

// grammarTc39Patterns is the pinned draft's MatchPattern, with Appendix A's
// ArrayPattern and RegularExpressionPattern. Its CombinedMatchPattern is
// stratified, so a chain has one derivation; the set of sentences is the
// draft's, and its early errors stay the compiler's. MetaProperty is outside
// the subset, and templates are one token.
const grammarTc39Patterns = `
MatchPattern = MatchPrefixPattern | MatchPattern "and" MatchPrefixPattern | MatchPattern "or" MatchPrefixPattern
MatchPrefixPattern = "not" MatchPrefixPattern | MatchPrimaryPattern
MatchPrimaryPattern = "(" MatchPattern ")" | PrimitivePattern | VariableDeclarationPattern | MemberExpressionPattern | ObjectPattern | ArrayPattern | RegularExpressionPattern | UnaryAlgebraicPattern | RelationalPattern | IfPattern
PrimitivePattern = Literal | TemplateLiteral
VariableDeclarationPattern = LetOrConst BindingIdentifier
MemberExpressionPattern = PatternMatchingMemberExpression | PatternMatchingMemberExpression "(" MatchList ")"
PatternMatchingMemberExpression = "this" | IdentifierReference | "super" "." IdentifierName | PatternMatchingMemberExpression "." IdentifierName | PatternMatchingMemberExpression "." "#" IdentifierName | PatternMatchingMemberExpression "[" Expression "]"
ObjectPattern = "{" "}" | "{" MatchRestProperty "}" | "{" MatchPropertyList "}" | "{" MatchPropertyList "," "}" | "{" MatchPropertyList "," MatchRestProperty "}"
MatchList = MatchElision? MatchRestElement? | MatchElementList | MatchElementList "," MatchElision? MatchRestElement?
MatchElision = "," | MatchElision ","
MatchRestProperty = "..." MatchPattern
MatchPropertyList = MatchProperty | MatchPropertyList "," MatchProperty
MatchElementList = MatchElisionElement | MatchElementList "," MatchElisionElement
MatchElisionElement = MatchElision? MatchElement
MatchProperty = PropertyName "?"? | PropertyName "?"? ":" MatchPattern | LetOrConst BindingIdentifier "?"? | LetOrConst BindingIdentifier "?"? ":" MatchPattern
MatchElement = MatchPattern "?"?
MatchRestElement = "..." | "..." MatchPattern
UnaryAlgebraicPattern = PatternMatchingUnaryAlgebraicExpression
PatternMatchingUnaryAlgebraicExpression = "+" PatternMatchingMemberExpression | "-" PatternMatchingMemberExpression | "+" NumericLiteral | "-" NumericLiteral
RelationalPattern = "<" PatternMatchingRelationalExpression | ">" PatternMatchingRelationalExpression | "<=" PatternMatchingRelationalExpression | ">=" PatternMatchingRelationalExpression | "instanceof" PatternMatchingMemberExpression | "in" PatternMatchingMemberExpression | "==" PatternMatchingRelationalExpression | "!=" PatternMatchingRelationalExpression | "===" PatternMatchingRelationalExpression | "!==" PatternMatchingRelationalExpression
PatternMatchingRelationalExpression = Literal | TemplateLiteral | PatternMatchingMemberExpression | PatternMatchingUnaryAlgebraicExpression
IfPattern = "if" "(" Expression ")"
IsTest = RelationalExpression [no LineTerminator here] "is" MatchPattern
`

// grammarTc39Do is the pinned draft's DoExpression; its ExpressionStatement
// lookahead is in the subset, where no other expression starts with "do".
const grammarTc39Do = `
DoExpression = "do" Block
`

// grammarModuleProduction is VIP-40's ModuleDeclaration, which Appendix A now
// writes as a production the reader reads; TestGrammarAdmissionQuoted pins it.
// ModuleBody is TypeScript; the subset reads it as Statements, VibeLang
// included, so the lab admits more than the specification there and can miss
// a compiler that accepts VibeLang in a body.
const grammarModuleProduction = `"module" [no LineTerminator here] BindingIdentifier "{" ModuleBody? "}"`

// grammarThrowPunctuators returns the body of Appendix A's
// ThrowExpressionInvalidPunctuator, continuation lines included.
func grammarThrowPunctuators(text string) string {
	const head = "ThrowExpressionInvalidPunctuator = "
	at := strings.Index(text, head)
	if at < 0 {
		return ""
	}
	lines := strings.Split(text[at+len(head):], "\n")
	body := lines[0]
	for _, l := range lines[1:] {
		if !strings.HasPrefix(strings.TrimSpace(l), "|") {
			break
		}
		body += " " + strings.TrimSpace(l)
	}
	return body
}

var grammarQuotedToken = regexp.MustCompile(`"[^"\s]+"`)

// grammarSubsetHooks says where the subset admits each Appendix A production that
// no other production names, by the alternatives ECMAScript gives the
// construct it mirrors: an effect function stands where an async function
// does, try where await does, a VibeLang statement where a statement does,
// and A!E!R where a type does. A production comment such as "(a
// PrimaryExpression)" or "(where ECMAScript has AwaitExpression)" overrides
// the table.
var grammarSubsetHooks = []struct{ at, name string }{
	{"ExportDeclaration", "VibeExportDeclaration"},
	{"PrimaryExpression", "PipeTopic"},
	{"PrimaryExpression", "DoExpression"},
	{"PrimaryExpression", "MatchExpression"},
	{"RelationalExpression", "IsTest"},
	{"RelationalExpression", "AssertedIsTest"},
	{"PrimaryExpression", "EffectFunction"},
	{"PrimaryExpression", "Producer"},
	{"PrimaryExpression", "EffectBlock"},
	{"HoistableDeclaration", "EffectFunction"},
	{"HoistableDeclaration", "Producer"},
	{"HoistableDeclaration", "AsyncShorthand"},
	{"AssignmentExpression", "EffectArrow"},
	{"UnaryExpression", "TryExpression"},
	{"UnaryExpression", "TryAll"},
	{"UnaryExpression", "ForkExpression"},
	{"UnaryExpression", "JoinExpression"},
	{"ShortCircuitExpression", "CatchExpression"},
	{"ClassElement", "EffectMethod"},
	{"ClassElement", "ProducerMethod"},
	{"PropertyDefinition", "EffectMethod"},
	{"PropertyDefinition", "ProducerMethod"},
	{"Type", "EffectType"},
	{"Statement", "ForConcurrent"},
	{"Statement", "ForTry"},
	{"Statement", "Uninterruptible"},
	{"Statement", "Restore"},
	{"Statement", "Interruptible"},
	{"Statement", "ProvideStatement"},
	{"Statement", "ServiceDecl"},
	{"Statement", "ServiceDeclaration"},
	{"Statement", "ErrorDecl"},
	{"Statement", "ErrorDeclaration"},
	{"Statement", "SchemaErrorDecl"},
	{"Statement", "SchemaErrorDeclaration"},
	{"Statement", "SchemaDecl"},
	{"Statement", "SchemaDeclaration"},
	{"Statement", "DataDecl"},
	{"Statement", "DataDeclaration"},
	{"UnaryExpression", "ThrowExpression"},
	{"ScriptItem", "ModuleDeclaration"},
}

// grammarPlacementComments are the production comments that say where a
// production stands.
var grammarPlacementComments = map[string]string{
	"a PrimaryExpression":                  "PrimaryExpression",
	"where ECMAScript has AwaitExpression": "UnaryExpression",
}

// grammarProseMeanings gives the subset production each prose alternative stands
// for, by the words it starts with. A prose alternative no entry matches
// stays an opaque terminal, listed by the target.
var grammarProseMeanings = []struct {
	re      *regexp.Regexp
	meaning string
	note    string
}{
	{regexp.MustCompile(`^(a type at TypeScript.s type-operator level|an ordinary TypeScript source type at the type-operator level)`), "PostfixType", "TypeScript type-operator level"},
	{regexp.MustCompile(`^an ordinary TypeScript class MethodDeclaration`), "MethodDefinition", "TypeScript class method or accessor"},
	{regexp.MustCompile(`^a ClassElement \(an EffectAccessor included\) that is not`), "ClassElement", "parses, then a static rule rejects it; the exclusions are not modeled"},
	{regexp.MustCompile(`^a ClassElement or a TypeScript TypeMember`), "RejectedMemberShape", "parses, then a static rule rejects it; the exclusions are not modeled"},
	{regexp.MustCompile(`^a Type that is not an unparenthesized EffectType`), "TypeNoEffect", "Type without the EffectType alternative"},
	{regexp.MustCompile(`^the class-member modifiers TypeScript allows before async`), "ClassMemberModifiers", ""},
	{regexp.MustCompile(`^the head of ECMAScript's for…of before "of"`), "ForOfHead", ""},
	{regexp.MustCompile(`^(a non-static MethodDeclaration|TypeScript's MethodDeclaration, without static)`), "NonStaticMethod", ""},
	{regexp.MustCompile(`^(a non-static get accessor|TypeScript's get accessor, without static)`), "GetAccessor", ""},
	{regexp.MustCompile(`^a LineTerminator before the next token`), "LineTerminator", ""},
	{regexp.MustCompile(`^an ordinary TypeScript import declaration using ModuleSpecifier`), "TsImportDeclaration", "TypeScript's import, side-effect form included, with VIP-40's ModuleSpecifier"},
	{regexp.MustCompile(`^Undecided \(pending VIP\): UnaryExpression`), "UnaryExpression", "undecided; the search takes the first option, UnaryExpression"},
}

// grammarUndefinedMeanings stands in for a name a production uses and none
// defines, where Appendix A says what it may be: "Undecided (pending VIP):
// ForkOperand, ... (a UnaryExpression or an AssignmentExpression)" gives the
// first option. The name is still reported as undefined.
var grammarUndefinedMeanings = map[string]string{"ForkOperand": "UnaryExpression"}

// An grammarAppendixData is Appendix A read from one copy of the specification.
type grammarAppendixData struct {
	file     string
	defs     []grammarNdef
	examples []grammarExample
	keywords []grammarKeywordRule
	rules    []grammarProseRule
	text     string // Appendix A's prose
	// relational drops the expression type-argument alternatives of
	// MemberExpression: the reading TypeScript's parser falls back to when
	// tryParseTypeArgumentsInExpression rewinds a list that does not close.
	relational bool
}

// A grammarExample is a line of a text block in Appendix A that is not a
// production: a sentence, then, after two spaces, what it means.
type grammarExample struct {
	Line     int
	Sentence string
	Meaning  string
	joins    bool // the description ends with a comma: the next line goes on with this one
}

var grammarExampleSplit = regexp.MustCompile(`\s{2,}`)

// grammarReadAppendix reads Appendix A's productions and examples.
func grammarReadAppendix(text, file string) (*grammarAppendixData, error) {
	a := &grammarAppendixData{file: file}
	lines := strings.Split(text, "\n")
	from, to := -1, len(lines)
	prodAt := -1
	for i, l := range lines {
		switch {
		case strings.HasPrefix(l, "## Appendix A"):
			from = i + 1
		case from >= 0 && prodAt < 0 && strings.HasPrefix(l, "### Productions"):
			prodAt = i + 1
		case from >= 0 && i+1 > from && strings.HasPrefix(l, "## ") && !strings.HasPrefix(l, "## Appendix A"):
			if to == len(lines) {
				to = i + 1
			}
		}
	}
	if from < 0 || prodAt < 0 {
		return nil, fmt.Errorf("%s: no Appendix A with a ### Productions section", file)
	}
	a.text = strings.Join(lines[from-1:to-1], "\n")
	names := appendixProductions(text)
	blocks := grammarLines(text)
	var nums []int
	for n := range blocks {
		if n > from && n < to {
			if m := production.FindStringSubmatch(blocks[n]); m != nil {
				names[m[1]] = true
			}
			nums = append(nums, n)
		}
	}
	sort.Ints(nums)
	type pending struct {
		name, body string
		line       int
	}
	var cur *pending
	flush := func() {
		if cur != nil {
			d := grammarParseDef(cur.name, cur.body, cur.line)
			d.vibe = true
			a.defs = append(a.defs, d)
			cur = nil
		}
	}
	continuation := regexp.MustCompile(`^\s+\|`)
	for k, n := range nums {
		l := blocks[n]
		if m := production.FindStringSubmatch(l); m != nil && names[m[1]] {
			flush()
			body := strings.TrimSpace(l[strings.Index(l, "=")+1:])
			cur = &pending{m[1], body, n}
			continue
		}
		if cur != nil && continuation.MatchString(l) && k > 0 && nums[k-1] == n-1 {
			cur.body += " " + strings.TrimSpace(l)
			continue
		}
		flush()
		if strings.TrimSpace(l) == "" {
			continue
		}
		parts := grammarExampleSplit.Split(strings.TrimSpace(l), -1)
		ex := grammarExample{Line: n, Sentence: parts[0]}
		if len(parts) > 1 {
			ex.Meaning = parts[len(parts)-1]
		}
		var prev *grammarExample
		if k > 0 && nums[k-1] == n-1 && len(a.examples) > 0 && a.examples[len(a.examples)-1].Line == n-1 {
			prev = &a.examples[len(a.examples)-1]
		}
		switch {
		case prev != nil && grammarExampleSplit.MatchString(l[:min(len(l), 2)]):
			// An indented line continues the description above it.
			prev.Meaning += " " + strings.TrimSpace(l)
			prev.Line = n
			continue
		case prev != nil && prev.joins:
			// A description that ends with a comma goes on with the next
			// line, whose sentence goes on with this one's.
			prev.Sentence += "\n" + ex.Sentence
			prev.Meaning += " " + ex.Meaning
			prev.Line = n
			prev.joins = strings.HasSuffix(ex.Meaning, ",")
			continue
		}
		ex.joins = strings.HasSuffix(ex.Meaning, ",")
		a.examples = append(a.examples, ex)
		// "schema as T;  data as T;  syntax errors": a middle column that
		// ends like a statement is another sentence with the same meaning.
		for _, mid := range parts[1:max(1, len(parts)-1)] {
			if strings.HasSuffix(mid, ";") {
				a.examples = append(a.examples, grammarExample{Line: n, Sentence: mid, Meaning: ex.Meaning})
			}
		}
	}
	flush()
	a.keywords = grammarReadKeywordTable(a.text)
	a.rules = grammarReadProseRules(a.text)
	return a, nil
}

// grammarWithoutExpressionTypeArguments removes an expression production's
// alternatives that read TypeArguments: the instantiation expression, the
// generic call, the generic `new` and the generic optional call.
func grammarWithoutExpressionTypeArguments(d grammarNdef) grammarNdef {
	var alts [][]grammarNelem
	var prose []string
	for k, alt := range d.alts {
		if slices.ContainsFunc(alt, func(e grammarNelem) bool { return e.name == "TypeArguments" }) {
			continue
		}
		alts = append(alts, alt)
		if k < len(d.prose) {
			prose = append(prose, d.prose[k])
		}
	}
	d.alts = alts
	if d.prose != nil {
		d.prose = prose
	}
	return d
}

// grammarBuildGrammar resolves an appendix against the subset into one grammar.
func grammarBuildGrammar(a *grammarAppendixData) *grammarCfg {
	g := &grammarCfg{index: map[string]int{}, ordered: map[int]bool{}, vibe: map[int]bool{}, helper: map[int]bool{}, effectWords: map[string]bool{}, comments: map[string][]string{}}
	var defs []grammarNdef
	tsDefs := map[string]grammarNdef{}
	for _, l := range strings.Split(grammarTsSubset, "\n") {
		if m := production.FindStringSubmatch(l); m != nil {
			d := grammarParseDef(m[1], strings.TrimSpace(l[strings.Index(l, "=")+1:]), 0)
			tsDefs[d.name] = d
		}
	}
	if a.relational {
		for _, name := range []string{"MemberExpression", "CallExpression", "OptionalChain"} {
			tsDefs[name] = grammarWithoutExpressionTypeArguments(tsDefs[name])
		}
	}
	defined := map[string]bool{}
	for _, d := range a.defs {
		defined[d.name] = true
	}
	// VIP-40 keeps native re-export syntax and extends its specifier to an
	// IdentifierReference. Native TypeScript keeps its StringLiteral boundary.
	if defined["ModuleSpecifier"] {
		tsDefs["ReExportDeclaration"] = grammarParseDef("ReExportDeclaration", `"export" "type"? ExportFromClause "from" ModuleSpecifier StatementEnd`, 0)
	}
	for _, l := range strings.Split(grammarTsSubset, "\n") {
		if m := production.FindStringSubmatch(l); m != nil && !defined[m[1]] {
			defs = append(defs, tsDefs[m[1]])
		}
	}
	// "(... TypeScript overload signatures and semicolon insertion)": such a
	// production's ";" is ECMAScript's, which a line break may stand for.
	for i := range a.defs {
		for _, c := range a.defs[i].comments {
			if strings.Contains(c, "semicolon insertion") {
				grammarSemicolonInsertion(a.defs[i].alts)
			}
		}
	}
	defs = append(defs, a.defs...)
	// Appendix A incorporates the pinned Hack proposal. Its topic primary is
	// external, not an inherited TypeScript production; install it only when
	// Appendix A admits PipeExpression, keeping the TS-only grammar unchanged.
	if defined["PipeExpression"] {
		topic := grammarParseDef("PipeTopic", `"%"`, 0)
		topic.vibe = true
		topic.source = "vips/tc39-pipeline-operator/spec.html"
		defs = append(defs, topic)
		defined["PipeTopic"] = true
	}
	// Appendix A also incorporates the pinned do-expression and
	// pattern-matching drafts; their productions are external, not TypeScript.
	if defined["MatchExpression"] {
		for _, source := range []struct{ source, text string }{
			{"vips/tc39-pattern-matching/spec.emu", grammarTc39Patterns},
			{"vips/tc39-do-expressions/spec.emu", grammarTc39Do},
		} {
			for _, line := range strings.Split(strings.TrimSpace(source.text), "\n") {
				name, body, _ := strings.Cut(line, " = ")
				d := grammarParseDef(name, body, 0)
				d.vibe = true
				d.source = source.source
				defs = append(defs, d)
				defined[name] = true
			}
		}
	}
	// The inherited TypeScript assertion operators can wrap an is test.
	// Keep this bridge separate from the pinned pattern productions and from
	// native UpdateExpression assertions, so native expressions gain no duplicate
	// derivations and a type's [] suffix is not read as a pattern member.
	if defined["IsTest"] {
		d := grammarParseDef("AssertedIsTest", `IsTest [no LineTerminator here] "as" Type [lookahead ∉ { "|", "&" }] | IsTest [no LineTerminator here] "satisfies" Type [lookahead ∉ { "|", "&" }] | AssertedIsTest [no LineTerminator here] "as" Type [lookahead ∉ { "|", "&" }] | AssertedIsTest [no LineTerminator here] "satisfies" Type [lookahead ∉ { "|", "&" }]`, 0)
		d.vibe = true
		d.source = a.file
		defs = append(defs, d)
		defined["AssertedIsTest"] = true
	}
	// Appendix A admits ordinary exports of its custom declarations through
	// ECMAScript's ExportDeclaration. Keep default exports on their native
	// alternatives and do not install this bridge in the TypeScript-only lab.
	if strings.Contains(a.text, grammarDeclarationExportQuote) {
		var exports []string
		for _, name := range []string{"ServiceDeclaration", "ErrorDeclaration", "SchemaErrorDeclaration", "SchemaDeclaration", "DataDeclaration"} {
			if defined[name] {
				exports = append(exports, `"export" `+name)
			}
		}
		if len(exports) > 0 {
			d := grammarParseDef("VibeExportDeclaration", strings.Join(exports, " | "), 0)
			d.vibe, d.source = true, a.file
			defs = append(defs, d)
			defined["VibeExportDeclaration"] = true
		}
	}
	// VIP-41 imports the pinned throw-expression draft: one UnaryExpression
	// alternative whose lookahead is Appendix A's ThrowExpressionInvalidPunctuator.
	// The lookahead makes such a token offending, so after a line break ASI ends
	// the expression when the token can start a statement (ECMA-262 ASI rule 1).
	// The lab's ASI symbol sits after the expression and can't be reached from a
	// failed lookahead, so the second alternative carries that case. A "*" after
	// a class field starts a generator method; FieldDefinition carries that one.
	if defined["ThrowExpressionInvalidPunctuator"] {
		set := grammarQuotedToken.FindAllString(grammarThrowPunctuators(a.text), -1)
		d := grammarParseDef("ThrowExpression", `"throw" UnaryExpression [lookahead ∉ { `+strings.Join(set, ", ")+` }] | "throw" UnaryExpression LineTerminator [lookahead ∈ { "+", "-", "/", "/=", "<" }]`, 0)
		d.vibe = true
		d.source = "vips/tc39-throw-expressions/spec.emu"
		defs = append(defs, d)
		defined["ThrowExpression"] = true
	}
	all := map[string]bool{}
	for _, d := range defs {
		all[d.name] = true
	}
	// Hooks, unless an Appendix A production already names the production
	// or redefines where it would go.
	named := map[string]bool{}
	for _, d := range a.defs {
		for _, alt := range d.alts {
			grammarWalkNames(alt, func(n string) { named[n] = true })
		}
	}
	placed := map[string]string{}
	for _, d := range a.defs {
		for _, c := range d.comments {
			if at, ok := grammarPlacementComments[c]; ok {
				placed[d.name] = at
			}
		}
	}
	extra := map[string][][]grammarNelem{}
	for _, h := range grammarSubsetHooks {
		if !defined[h.name] {
			continue
		}
		at := h.at
		if p, ok := placed[h.name]; ok {
			at = p
		}
		if defined[at] {
			continue
		}
		if p, ok := placed[h.name]; ok && p != h.at && slices.ContainsFunc(grammarSubsetHooks, func(o struct{ at, name string }) bool { return o.name == h.name && o.at == p }) {
			continue
		}
		extra[at] = append(extra[at], []grammarNelem{{name: h.name}})
		g.hooks = append(g.hooks, at+" ← "+h.name)
	}
	for name, at := range placed {
		if slices.ContainsFunc(grammarSubsetHooks, func(o struct{ at, name string }) bool { return o.name == name && o.at == at }) || defined[at] {
			continue
		}
		extra[at] = append(extra[at], []grammarNelem{{name: name}})
		g.hooks = append(g.hooks, at+" ← "+name)
	}
	g.start = g.nt("Script")
	for _, d := range defs {
		lhs := g.nt(d.name)
		if d.vibe {
			g.vibe[lhs] = true
			g.comments[d.name] = d.comments
		}
		for _, c := range d.comments {
			if strings.Contains(c, "the first that matches") {
				g.ordered[lhs] = true
			}
		}
		src := "ts"
		if d.vibe {
			src = fmt.Sprintf("%s:%d", a.file, d.line)
		}
		if d.source != "" {
			src = d.source
		}
		alts := slices.Clone(d.alts)
		alts = append(alts, extra[d.name]...)
		for i, alt := range alts {
			if i < len(d.prose) && d.prose[i] != "" {
				meaning := ""
				note := "uninterpreted: an opaque terminal"
				for _, pm := range grammarProseMeanings {
					if pm.re.MatchString(d.prose[i]) {
						meaning, note = pm.meaning, pm.note
						break
					}
				}
				g.prose = append(g.prose, grammarProseTerm{Name: d.name, Text: d.prose[i], Line: d.line, Meaning: strings.TrimSpace(meaning + " " + note)})
				if meaning != "" {
					g.add(lhs, g.expand(d.name, []grammarNelem{{name: meaning}}, src, d.vibe, all), src, d.vibe)
				} else {
					g.add(lhs, []grammarGsym{{kind: grammarSymClass, text: "‹" + d.name + "›"}}, src, d.vibe)
				}
				continue
			}
			g.add(lhs, g.expand(d.name, alt, src, d.vibe, all), src, d.vibe)
		}
	}
	// Resolve names; a name nothing defines is an opaque terminal, unless
	// undefinedMeanings gives it a stand-in. Either way it is listed.
	missing := map[string]bool{}
	for r := range g.rules {
		for k, s := range g.rules[r].rhs {
			if s.kind != grammarSymNT {
				continue
			}
			if i, ok := g.index[s.text]; ok && len(g.byLHS[i]) > 0 {
				g.rules[r].rhs[k].nt = i
				continue
			}
			missing[s.text] = true
			if stand, ok := grammarUndefinedMeanings[s.text]; ok {
				g.rules[r].rhs[k].text = stand
				g.rules[r].rhs[k].nt = g.index[stand]
				continue
			}
			g.rules[r].rhs[k] = grammarGsym{kind: grammarSymClass, text: "‹" + s.text + "›"}
		}
	}
	for n := range missing {
		g.unresolved = append(g.unresolved, n)
	}
	sort.Strings(g.unresolved)
	g.provideKeywordHead()
	g.effectDeclarationNames()
	return g.parameterize()
}

// provideKeywordHead derives keyword lookahead from the current appendix rule.
// Replace only its final Block with the opening brace; provider productions,
// parameters and line-break restrictions retain their original authority.
func (g *grammarCfg) provideKeywordHead() {
	for _, r := range slices.Clone(g.rules) {
		if g.names[r.lhs] != "ProvideStatement" || len(r.rhs) == 0 {
			continue
		}
		last := r.rhs[len(r.rhs)-1]
		if last.kind != grammarSymNT || last.text != "Block" {
			continue
		}
		nt := g.nt("ProvideKeywordHead")
		g.helper[nt], g.vibe[nt] = true, true
		rhs := slices.Clone(r.rhs)
		rhs[len(rhs)-1] = grammarGsym{kind: grammarSymTok, text: "{"}
		g.add(nt, rhs, r.src, r.vibe)
	}
}

// effectDeclarationNames splits the declaration placement of a shared Appendix A
// function production from its expression placement. Name's prose gives only
// declarations the enclosing context; expression names keep the body's context.
// Clone the parsed productions, including their source citations, rather than
// restating a second grammar that could drift from Appendix A.
func (g *grammarCfg) effectDeclarationNames() {
	declarations := map[string]string{
		"EffectFunction":         "EffectFunctionDeclaration",
		"EffectFunctionOverload": "EffectFunctionOverloadDeclaration",
		"Producer":               "ProducerDeclaration",
	}
	for _, r := range slices.Clone(g.rules) {
		if name, ok := declarations[g.names[r.lhs]]; ok {
			lhs := g.nt(name)
			g.vibe[lhs] = g.vibe[r.lhs]
			rhs := slices.Clone(r.rhs)
			for i := range rhs {
				if name, ok := declarations[rhs[i].text]; ok && rhs[i].kind == grammarSymNT {
					rhs[i].text, rhs[i].nt = name, g.nt(name)
				}
			}
			g.add(lhs, rhs, r.src, r.vibe)
		}
	}
	for i := range g.rules {
		r := &g.rules[i]
		if g.names[r.lhs] != "HoistableDeclaration" {
			continue
		}
		for k := range r.rhs {
			s := &r.rhs[k]
			if name, ok := declarations[s.text]; ok && s.kind == grammarSymNT {
				s.text, s.nt = name, g.nt(name)
			}
		}
	}
}

// grammarEffectBodies are the subset's function-like productions, whose parameters
// and body are parsed with [~Effect], as ECMAScript parses a nested plain
// function's with [~Await].
var grammarEffectBodies = map[string]bool{"FunctionDeclaration": true, "FunctionExpression": true, "AsyncFunctionExpression": true, "AsyncGeneratorExpression": true, "GeneratorExpression": true, "ArrowFunction": true, "AsyncArrowFunction": true, "MethodDefinition": true, "GetAccessor": true, "NonStaticMethod": true}

// Module top level reserves await, but retains the ordinary for-of head.
// Async bodies reserve await and permit the distinct async assignment head.
// Plain callable bodies and field initializers reset the native context.
type grammarAwaitContext uint8

const (
	grammarAwaitNone grammarAwaitContext = iota
	grammarAwaitModule
	grammarAwaitAsync
)

// parameterize carries Effect and the bounded native Await context. It models
// await IdentifierReference reservation and ordinary for-of head selection;
// other native Await and Yield early errors remain outside the bounded lab.
func (g *grammarCfg) parameterize() *grammarCfg {
	h := &grammarCfg{index: map[string]int{}, ordered: map[int]bool{}, vibe: map[int]bool{}, helper: map[int]bool{}, prose: g.prose, unresolved: g.unresolved, hooks: g.hooks, comments: g.comments}
	idx := func(nt int, effect bool, await grammarAwaitContext) int {
		name := g.names[nt]
		switch await {
		case grammarAwaitModule:
			name += "ᵐ"
		case grammarAwaitAsync:
			name += "ᵃ"
		}
		if effect {
			name += "⁺"
		}
		_, had := h.index[name]
		i := h.nt(name)
		if !had {
			h.vibe[i], h.helper[i], h.ordered[i] = g.vibe[nt], g.helper[nt], g.ordered[nt]
		}
		return i
	}
	for nt := range g.names {
		for _, effect := range []bool{false, true} {
			for _, await := range []grammarAwaitContext{grammarAwaitNone, grammarAwaitModule, grammarAwaitAsync} {
				idx(nt, effect, await)
			}
		}
	}
	for _, r := range g.rules {
		owner := g.names[r.lhs]
		rawOwner := owner
		if at := strings.IndexAny(owner, "#:"); at > 0 {
			owner = owner[:at]
		}
		plain := !r.vibe && grammarEffectBodies[owner]
		// Group/optional helpers inherit their callable's already-selected
		// context; they must not reset an async body a second time.
		callable := plain && rawOwner == owner
		// Appendix A gives class fields (the service default included) and
		// enum initializers a plain source context. Optional/group helpers
		// retain the reset; computed names below retain the enclosing context.
		initializer := owner == "FieldDefinition" || owner == "EnumMember" || owner == "DefaultMember"
		resetAwait := callable || initializer
		for _, effect := range []bool{false, true} {
			for _, await := range []grammarAwaitContext{grammarAwaitNone, grammarAwaitModule, grammarAwaitAsync} {
				rhs := slices.Clone(r.rhs)
				child := effect && !plain && !initializer
				childAwait := await
				if resetAwait {
					childAwait = grammarAwaitNone
				}
				for k := range rhs {
					s := &rhs[k]
					if callable && s.kind == grammarSymTok && s.text == "async" {
						childAwait = grammarAwaitAsync
					}
					if s.kind == grammarSymTok && s.text == "effect" || s.kind == grammarSymNT && s.text == "EffectModifier" {
						child = true
						childAwait = grammarAwaitNone
					}
					s.eff = effect
					s.await = childAwait
					// Native declarations take their name from the enclosing
					// context; expressions take it from their own callable.
					if rawOwner == "FunctionDeclaration" && s.kind == grammarSymClass && s.text == "BindingIdentifier" {
						s.await = await
					}
					if r.vibe && s.kind == grammarSymClass {
						s.eff = child
					}
					if s.kind == grammarSymNT {
						s.eff = child
						symbolAwait := childAwait
						// Computed names precede their callable/initializer context:
						// ECMAScript's ClassElementName carries the enclosing Yield
						// and Await, and Appendix A's Effect follows them, so
						// `[try k()]() { }` in an effect function keeps `try`.
						// RejectedMemberShape restates the class-field alternatives
						// for service recovery. Its initializer has the same reset
						// even when it also matches an admitted DefaultMember.
						if owner == "RejectedMemberShape" && (s.text == "Initializer" || s.text == "Initializer?") {
							s.eff = false
							symbolAwait = grammarAwaitNone
						}
						if s.text == "PropertyName" || s.text == "ClassElementName" {
							symbolAwait = await
							s.eff = effect
						}
						// A callable nested as a whole alternative (a method's
						// accessor) resets its own body; it is named in the
						// enclosing context.
						if grammarEffectBodies[s.text] {
							symbolAwait = await
							s.eff = effect
						}
						if rawOwner == "ClassElement" && len(r.rhs) == 2 && r.rhs[0].text == "static" && s.text == "Block" {
							symbolAwait = grammarAwaitAsync
						}
						if (owner == "EffectFunctionDeclaration" || owner == "EffectFunctionOverloadDeclaration" || owner == "ProducerDeclaration") && s.text == "Name?" {
							s.eff = effect
							symbolAwait = await
						}
						if s.effectArg != 0 {
							s.eff = s.effectArg > 0
						}
						target := s.nt
						if childAwait == grammarAwaitAsync && s.text == "ForOfHead" {
							target = g.index["ForAwaitOfHead"]
						}
						s.nt = idx(target, s.eff, symbolAwait)
						s.text = h.names[s.nt]
					}
				}
				h.add(idx(r.lhs, effect, await), rhs, r.src, r.vibe)
			}
		}
	}
	h.start, h.startE = idx(g.start, false, grammarAwaitModule), idx(g.start, true, grammarAwaitNone)
	h.analyze()
	return h
}

// named returns every supported context copy of a nonterminal.
func (g *grammarCfg) named(name string) []int {
	var out []int
	for _, suffix := range []string{"", "⁺", "ᵐ", "ᵐ⁺", "ᵃ", "ᵃ⁺"} {
		if i, ok := g.index[name+suffix]; ok {
			out = append(out, i)
		}
	}
	return out
}

// base is a nonterminal's name without its context parameters.
func (g *grammarCfg) base(nt int) string {
	return strings.TrimRight(g.names[nt], "⁺ᵃᵐ")
}

func grammarWalkNames(alt []grammarNelem, f func(string)) {
	for _, e := range alt {
		if e.name != "" {
			f(e.name)
		}
		for _, sub := range e.alts {
			grammarWalkNames(sub, f)
		}
	}
}

// expand turns notation elements into symbols, adding helper nonterminals
// for groups and suffixes.
func (g *grammarCfg) expand(owner string, alt []grammarNelem, src string, vibe bool, all map[string]bool) []grammarGsym {
	var out []grammarGsym
	for _, e := range alt {
		var s grammarGsym
		switch {
		case e.sym != nil:
			s = *e.sym
		case e.name == "LineTerminator":
			s = grammarGsym{kind: grammarSymLT}
		case e.name == "ASI":
			s = grammarGsym{kind: grammarSymASI}
		case grammarTokenClasses[e.name]:
			s = grammarGsym{kind: grammarSymClass, text: e.name}
		case e.name != "":
			s = grammarGsym{kind: grammarSymNT, text: e.name, effectArg: e.effectArg}
		default:
			g.fresh++
			name := fmt.Sprintf("%s#%d", owner, g.fresh)
			h := g.nt(name)
			g.helper[h] = true
			for _, sub := range e.alts {
				g.add(h, g.expand(owner, sub, src, vibe, all), src, vibe)
			}
			s = grammarGsym{kind: grammarSymNT, text: name}
		}
		if e.suffix != 0 {
			label := s.text
			if s.effectArg != 0 {
				label += fmt.Sprintf("[Effect=%d]", s.effectArg)
			}
			if s.kind != grammarSymNT && s.kind != grammarSymClass {
				label = fmt.Sprint(s)
			}
			if s.kind == grammarSymTok {
				label = `"` + s.text + `"`
			}
			name := label + string(e.suffix)
			if s.kind != grammarSymNT {
				name = owner + ":" + name
			}
			if _, ok := g.index[name]; !ok {
				h := g.nt(name)
				g.helper[h] = true
				self := grammarGsym{kind: grammarSymNT, text: name}
				switch e.suffix {
				case '?':
					g.add(h, []grammarGsym{s}, src, vibe)
					g.add(h, nil, src, vibe)
				case '*':
					g.add(h, nil, src, vibe)
					g.add(h, []grammarGsym{self, s}, src, vibe)
				case '+':
					g.add(h, []grammarGsym{s}, src, vibe)
					g.add(h, []grammarGsym{self, s}, src, vibe)
				}
			}
			s = grammarGsym{kind: grammarSymNT, text: name}
		}
		out = append(out, s)
	}
	return out
}

// analyze computes which nonterminals derive the empty string (assertions
// count as empty), the first terminals of each nonterminal and rule, and
// each nonterminal's shortest yield.
func (g *grammarCfg) analyze() {
	n := len(g.names)
	g.nullable = make([]bool, n)
	g.first = make([]map[string]bool, n)
	g.minLen = make([]int, n)
	for i := range g.first {
		g.first[i] = map[string]bool{}
		g.minLen[i] = 1 << 20
	}
	g.ruleFirst = make([]map[string]bool, len(g.rules))
	g.ruleNullable = make([]bool, len(g.rules))
	for r := range g.rules {
		g.ruleFirst[r] = map[string]bool{}
	}
	for changed := true; changed; {
		changed = false
		for ri, r := range g.rules {
			if slices.ContainsFunc(r.rhs, func(s grammarGsym) bool { return s.kind == grammarSymGuard && s.on != s.eff }) {
				continue
			}
			nullable := true
			for _, s := range r.rhs {
				if !nullable {
					break
				}
				switch s.kind {
				case grammarSymNT:
					for k := range g.first[s.nt] {
						g.ruleFirst[ri][k] = true
					}
					nullable = g.nullable[s.nt]
				case grammarSymTok, grammarSymClass:
					g.ruleFirst[ri][grammarTermKey(s)] = true
					nullable = false
				}
			}
			for k := range g.ruleFirst[ri] {
				if !g.first[r.lhs][k] {
					g.first[r.lhs][k] = true
					changed = true
				}
			}
			g.ruleNullable[ri] = nullable
			if nullable && !g.nullable[r.lhs] {
				g.nullable[r.lhs] = true
				changed = true
			}
			full := 0
			for _, s := range r.rhs {
				switch s.kind {
				case grammarSymNT:
					full += g.minLen[s.nt]
				case grammarSymTok, grammarSymClass:
					full++
				}
			}
			if full < g.minLen[r.lhs] {
				g.minLen[r.lhs] = full
				changed = true
			}
		}
	}
}

func grammarTermKey(s grammarGsym) string {
	if s.kind == grammarSymTok {
		return "t:" + s.text
	}
	return "c:" + s.text
}

// ruleString writes a rule for messages.
func (g *grammarCfg) ruleString(r int) string {
	if r < 0 {
		return "token"
	}
	var parts []string
	for _, s := range g.rules[r].rhs {
		switch s.kind {
		case grammarSymNT:
			parts = append(parts, g.names[s.nt])
		case grammarSymTok:
			parts = append(parts, `"`+s.text+`"`)
		case grammarSymClass:
			parts = append(parts, s.text)
		case grammarSymNoLT:
			parts = append(parts, "[no LineTerminator here]")
		case grammarSymLT:
			parts = append(parts, "LineTerminator")
		case grammarSymASI:
			parts = append(parts, "ASI")
		case grammarSymGuard:
			parts = append(parts, fmt.Sprintf("[guard %v]", s.on))
		default:
			parts = append(parts, fmt.Sprintf("[lookahead %v %v]", s.kind, s.seqs))
		}
	}
	return fmt.Sprintf("#%d %s = %s (%s)", r, g.names[g.rules[r].lhs], strings.Join(parts, " "), g.rules[r].src)
}

// alt names a rule by its production and alternative, such as
// "CatchExpression.0", without the grammar parameter.
func (g *grammarCfg) alt(r int) string {
	if r < 0 {
		return "token"
	}
	lhs := g.rules[r].lhs
	n := 0
	for _, q := range g.byLHS[lhs] {
		if q == r {
			break
		}
		n++
	}
	return fmt.Sprintf("%s.%d", g.base(lhs), n)
}

// follow returns, for each nonterminal, the tokens that can follow it.
func (g *grammarCfg) follow() []map[string]bool {
	f := make([]map[string]bool, len(g.names))
	for i := range f {
		f[i] = map[string]bool{}
	}
	for changed := true; changed; {
		changed = false
		for _, r := range g.rules {
			for k, s := range r.rhs {
				if s.kind != grammarSymNT {
					continue
				}
				end := true
				for _, t := range r.rhs[k+1:] {
					if t.kind == grammarSymNT {
						for key := range g.first[t.nt] {
							if !f[s.nt][key] {
								f[s.nt][key] = true
								changed = true
							}
						}
						if !g.nullable[t.nt] {
							end = false
							break
						}
					} else if t.kind == grammarSymTok || t.kind == grammarSymClass {
						if key := grammarTermKey(t); !f[s.nt][key] {
							f[s.nt][key] = true
							changed = true
						}
						end = false
						break
					}
				}
				if end {
					for key := range f[r.lhs] {
						if !f[s.nt][key] {
							f[s.nt][key] = true
							changed = true
						}
					}
				}
			}
		}
	}
	return f
}

// Attached arguments parameterize a nonterminal; unlike a prefix [+Effect]
// guard they consume no source token. The lab models Effect only, while
// retaining ECMAScript's other parameter names without opaque terminals.
func grammarEffectArgument(text string) (int8, bool) {
	var effect int8
	for _, raw := range strings.Split(text, ",") {
		arg := strings.TrimSpace(raw)
		if len(arg) < 2 || !strings.ContainsRune("+~?", rune(arg[0])) ||
			!slices.Contains([]string{"In", "Yield", "Await", "Effect", "Return", "Default"}, arg[1:]) {
			return 0, false
		}
		if arg == "+Effect" {
			effect = 1
		}
		if arg == "~Effect" {
			effect = -1
		}
	}
	return effect, true
}

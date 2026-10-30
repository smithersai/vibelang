package vibelangfuzz

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
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
	kind  grammarSymKind
	text  string // a nonterminal's name, a token or a class
	nt    int
	seqs  [][]string
	on    bool // [+Effect] rather than [~Effect]; for a lookahead, on one line
	prose bool // an assertion only Appendix A's prose rules make
	eff   bool // the symbol stands in effect code ([+Effect])
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
			j := i + 1
			for j < len(rs) && rs[j] != ']' {
				j++
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
	return r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
}

func isGrammarName(s string) bool {
	return s != "" && s[0] >= 'A' && s[0] <= 'Z' && !strings.ContainsAny(s, "'’-…")
}

// A notation element is a symbol, a name or a group, with its suffix.
type grammarNelem struct {
	sym    *grammarGsym
	name   string
	alts   [][]grammarNelem
	suffix byte
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
}

// grammarSplitAlts splits a production body at its top-level "|".
func grammarSplitAlts(body string) []string {
	var alts []string
	depth, start := 0, 0
	inQuote, inBracket := false, false
	rs := []rune(body)
	for i, r := range rs {
		switch {
		case inQuote:
			inQuote = r != '"'
		case inBracket:
			inBracket = r != ']'
		case r == '"':
			inQuote = true
		case r == '[':
			inBracket = true
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

// grammarBracketSym reads an ECMAScript restriction or a grammar parameter.
func grammarBracketSym(text string) *grammarGsym {
	t := strings.TrimSpace(text)
	switch {
	case t == "no LineTerminator here":
		return &grammarGsym{kind: grammarSymNoLT}
	case t == "+Effect" || t == "~Effect":
		return &grammarGsym{kind: grammarSymGuard, on: t == "+Effect"}
	case strings.HasPrefix(t, "lookahead ∉") || strings.HasPrefix(t, "lookahead ≠") || strings.HasPrefix(t, "lookahead ∈") || strings.HasPrefix(t, "lookahead ="):
		kind := grammarSymNotAhead
		if strings.Contains(t, "∈") || strings.Contains(t, "=") {
			kind = grammarSymAhead
		}
		set := t[strings.IndexAny(t, "∉≠∈=")+len("∉"):]
		if strings.ContainsAny(t, "=") {
			set = t[strings.Index(t, "=")+1:]
		}
		set = strings.TrimSpace(set)
		set = strings.TrimSuffix(strings.TrimPrefix(set, "{"), "}")
		var seqs [][]string
		for _, part := range strings.Split(set, ",") {
			var seq []string
			for _, m := range grammarNotationQuoted.FindAllStringSubmatch(part, -1) {
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

// grammarTsSubset is the TypeScript the search embeds: ECMAScript 2025's
// statements and expressions and TypeScript 5.9's types, cut to what the
// VibeLang productions and the specification's examples touch (no regular
// expressions, templates as one token, no JSX, no decorators, no enums or
// namespaces). Each rule is ECMAScript's or
// TypeScript's own, with four liberties: helper names; ASI as an explicit
// symbol (see earley); the restrictions the TypeScript parser puts on line
// breaks (before "as", "!", "[]" and after a modifier, "readonly" in a
// type member included); and lookaheads for
// the choices TypeScript's parser makes greedily, where the written grammar
// has two readings: a type after "as" takes a following "|" or "&", and a
// type name takes a following "<" as its type arguments, and "(" … ")"
// followed by "=>" is a function type. Script is the start symbol.
const grammarTsSubset = `
Script = Statement*
Statement = Block | VariableStatement | EmptyStatement | ExpressionStatement | IfStatement | WhileStatement | ForOfStatement | SwitchStatement | ReturnStatement | ThrowStatement | TryStatement | LabelledStatement | BreakStatement | ContinueStatement | Declaration
SwitchStatement = "switch" "(" Expression ")" "{" CaseClause* "}"
CaseClause = "case" Expression ":" Statement* | "default" ":" Statement*
Declaration = HoistableDeclaration | ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration | ImportDeclaration | ExportDeclaration
HoistableDeclaration = FunctionDeclaration
Block = "{" Statement* "}"
VariableStatement = LetOrConst BindingList StatementEnd | "using" [no LineTerminator here] BindingList StatementEnd
LetOrConst = "const" | "let" | "var"
BindingList = LexicalBinding | BindingList "," LexicalBinding
LexicalBinding = BindingIdentifier TypeAnnotation? Initializer? | BindingPattern TypeAnnotation? Initializer
Initializer = "=" AssignmentExpression
BindingPattern = "{" BindingPropertyList? "}" | "{" BindingPropertyList "," "}" | "[" BindingElementList? "]"
BindingPropertyList = BindingProperty | BindingPropertyList "," BindingProperty
BindingProperty = BindingIdentifier Initializer? | PropertyName ":" BindingIdentifier Initializer?
BindingElementList = BindingIdentifier | BindingElementList "," BindingIdentifier
EmptyStatement = ";"
ExpressionStatement = [lookahead ∉ { "{", "function", "class", "let" "[", "async" "function", "effect" "function", "using" }] Expression StatementEnd
StatementEnd = ";" | ASI
IfStatement = "if" "(" Expression ")" Statement "else" Statement | "if" "(" Expression ")" Statement [lookahead ∉ { "else" }]
WhileStatement = "while" "(" Expression ")" Statement
ForOfStatement = "for" "(" ForOfHead "of" AssignmentExpression ")" Statement
ForDeclaration = LetOrConst ForBinding
ForBinding = BindingIdentifier | BindingPattern
ForOfHead = LetOrConst BindingIdentifier | LetOrConst BindingPattern | [lookahead ∉ { "let", "async" "of" }] LeftHandSideExpression
ReturnStatement = "return" StatementEnd | "return" [no LineTerminator here] Expression StatementEnd
ThrowStatement = "throw" [no LineTerminator here] Expression StatementEnd
TryStatement = "try" Block Catch | "try" Block Finally | "try" Block Catch Finally
Catch = "catch" "(" BindingIdentifier ")" Block | "catch" Block
Finally = "finally" Block
LabelledStatement = LabelIdentifier ":" Statement
BreakStatement = "break" StatementEnd | "break" [no LineTerminator here] LabelIdentifier StatementEnd
ContinueStatement = "continue" StatementEnd | "continue" [no LineTerminator here] LabelIdentifier StatementEnd
FunctionDeclaration = "function" "*"? BindingIdentifier TypeParameters? "(" FormalParameters ")" TypeAnnotation? Block | "async" [no LineTerminator here] "function" BindingIdentifier TypeParameters? "(" FormalParameters ")" TypeAnnotation? Block
ClassDeclaration = "class" BindingIdentifier TypeParameters? ClassHeritage? "{" ClassElement* "}"
ClassHeritage = "extends" LeftHandSideExpression
ClassElement = ClassMemberModifiers? MethodDefinition | FieldDefinition | ";"
ClassMemberModifiers = ClassMemberModifier | ClassMemberModifiers ClassMemberModifier
ClassMemberModifier = "static" | "readonly" [no LineTerminator here] | "public" [no LineTerminator here] | "private" [no LineTerminator here] | "protected" [no LineTerminator here] | "override" [no LineTerminator here]
FieldDefinition = ClassMemberModifiers? PropertyName "?"? TypeAnnotation? Initializer? StatementEnd
MethodDefinition = PropertyName "?"? TypeParameters? "(" FormalParameters ")" TypeAnnotation? Block | GetAccessor | "set" [no LineTerminator here] PropertyName "(" FormalParameter ")" Block | "async" [no LineTerminator here] PropertyName "(" FormalParameters ")" TypeAnnotation? Block
GetAccessor = "get" [no LineTerminator here] PropertyName "(" ")" TypeAnnotation? Block
NonStaticMethod = PropertyName "?"? TypeParameters? "(" FormalParameters ")" TypeAnnotation? Block | "async" [no LineTerminator here] PropertyName "(" FormalParameters ")" TypeAnnotation? Block
InterfaceDeclaration = "interface" BindingIdentifier TypeParameters? InterfaceExtends? ObjectType
InterfaceExtends = "extends" TypeReference | InterfaceExtends "," TypeReference
TypeAliasDeclaration = "type" [no LineTerminator here] BindingIdentifier TypeParameters? "=" Type StatementEnd
ImportDeclaration = "import" ImportClause "from" StringLiteral StatementEnd | "import" StringLiteral StatementEnd
ImportClause = "{" "}" | "{" ImportsList ","? "}" | "*" "as" BindingIdentifier | BindingIdentifier | "type" "{" ImportsList ","? "}"
ImportsList = ImportSpecifier | ImportsList "," ImportSpecifier
ImportSpecifier = BindingIdentifier | IdentifierName "as" BindingIdentifier | "type" IdentifierName
ExportDeclaration = "export" VariableStatement | "export" HoistableDeclaration | "export" ClassDeclaration | "export" InterfaceDeclaration | "export" TypeAliasDeclaration | "export" "{" ImportsList? "}" StatementEnd | "export" "default" [lookahead ∉ { "{", "function", "class" }] AssignmentExpression StatementEnd
Expression = AssignmentExpression | Expression "," AssignmentExpression
AssignmentExpression = ConditionalExpression | ArrowFunction | AsyncArrowFunction | YieldExpression | LeftHandSideExpression "=" AssignmentExpression | LeftHandSideExpression AssignmentOperator AssignmentExpression
AssignmentOperator = "+=" | "-=" | "??="
ConditionalExpression = ShortCircuitExpression | ShortCircuitExpression "?" AssignmentExpression ":" AssignmentExpression
ShortCircuitExpression = LogicalORExpression | CoalesceExpression
CoalesceExpression = CoalesceExpressionHead "??" BitwiseORExpression
CoalesceExpressionHead = CoalesceExpression | BitwiseORExpression
LogicalORExpression = LogicalANDExpression | LogicalORExpression "||" LogicalANDExpression
LogicalANDExpression = BitwiseORExpression | LogicalANDExpression "&&" BitwiseORExpression
BitwiseORExpression = EqualityExpression | BitwiseORExpression "|" EqualityExpression
EqualityExpression = RelationalExpression | EqualityExpression EqualityOperator RelationalExpression
EqualityOperator = "===" | "!==" | "==" | "!="
RelationalExpression = AdditiveExpression | RelationalExpression RelationalOperator AdditiveExpression | RelationalExpression [no LineTerminator here] "as" Type [lookahead ∉ { "|", "&" }] | RelationalExpression [no LineTerminator here] "satisfies" Type [lookahead ∉ { "|", "&" }]
RelationalOperator = "<" | ">" | "<=" | ">=" | "instanceof" | "in"
AdditiveExpression = MultiplicativeExpression | AdditiveExpression "+" MultiplicativeExpression | AdditiveExpression "-" MultiplicativeExpression
MultiplicativeExpression = UnaryExpression | MultiplicativeExpression "*" UnaryExpression | MultiplicativeExpression "%" UnaryExpression
UnaryExpression = UpdateExpression | "!" UnaryExpression | "-" UnaryExpression | "+" UnaryExpression | "typeof" UnaryExpression | "void" UnaryExpression | "delete" UnaryExpression | AwaitExpression
AwaitExpression = "await" UnaryExpression
YieldExpression = "yield" [lookahead ∉ { "*" }] | "yield" [no LineTerminator here] AssignmentExpression | "yield" [no LineTerminator here] "*" AssignmentExpression
UpdateExpression = LeftHandSideExpression | LeftHandSideExpression [no LineTerminator here] "++" | "++" UnaryExpression
LeftHandSideExpression = NewExpression | CallExpression | OptionalExpression
NewExpression = MemberExpression | "new" NewExpression
MemberExpression = PrimaryExpression | "super" "." IdentifierName | "super" "[" Expression "]" | MemberExpression "[" Expression "]" | MemberExpression "." IdentifierName | MemberExpression [no LineTerminator here] "!" | MemberExpression TemplateLiteral | "new" MemberExpression Arguments
CallExpression = MemberExpression Arguments | "super" Arguments | CallExpression Arguments | CallExpression "[" Expression "]" | CallExpression "." IdentifierName | CallExpression [no LineTerminator here] "!"
OptionalExpression = MemberExpression OptionalChain | CallExpression OptionalChain | OptionalExpression OptionalChain
OptionalChain = "?." IdentifierName | "?." Arguments
Arguments = "(" ")" | "(" ArgumentList ","? ")"
ArgumentList = AssignmentExpression | "..." AssignmentExpression | ArgumentList "," AssignmentExpression | ArgumentList "," "..." AssignmentExpression
PrimaryExpression = "this" | IdentifierReference | Literal | ArrayLiteral | ObjectLiteral | FunctionExpression | GeneratorExpression | AsyncFunctionExpression | AsyncGeneratorExpression | ClassExpression | TemplateLiteral | ParenthesizedExpression
Literal = "null" | "true" | "false" | NumericLiteral | StringLiteral
ArrayLiteral = "[" "]" | "[" ElementList ","? "]"
ElementList = AssignmentExpression | "..." AssignmentExpression | ElementList "," AssignmentExpression | ElementList "," "..." AssignmentExpression
ObjectLiteral = "{" "}" | "{" PropertyDefinitionList ","? "}"
PropertyDefinitionList = PropertyDefinition | PropertyDefinitionList "," PropertyDefinition
PropertyDefinition = IdentifierReference | PropertyName ":" AssignmentExpression | MethodDefinition | "..." AssignmentExpression
PropertyName = IdentifierName | StringLiteral | NumericLiteral | "[" AssignmentExpression "]"
FunctionExpression = "function" BindingIdentifier? TypeParameters? "(" FormalParameters ")" TypeAnnotation? Block
ClassExpression = "class" BindingIdentifier? ClassHeritage? "{" ClassElement* "}"
ParenthesizedExpression = "(" Expression ")"
ArrowFunction = ArrowParameters [no LineTerminator here] "=>" ConciseBody | TypeParameters? "(" FormalParameters ")" TypeAnnotation [no LineTerminator here] "=>" ConciseBody | TypeParameters "(" FormalParameters ")" [no LineTerminator here] "=>" ConciseBody
ArrowParameters = BindingIdentifier | "(" FormalParameters ")"
AsyncArrowFunction = "async" [no LineTerminator here] ArrowParameters [no LineTerminator here] "=>" ConciseBody | "async" [no LineTerminator here] "(" FormalParameters ")" TypeAnnotation [no LineTerminator here] "=>" ConciseBody
ConciseBody = [lookahead ∉ { "{" }] AssignmentExpression | Block
FormalParameters = FormalParameterList? | FormalParameterList ","
FormalParameterList = FormalParameter | FormalParameterList "," FormalParameter
FormalParameter = ParameterModifier? BindingIdentifier "?"? TypeAnnotation? Initializer? | BindingPattern TypeAnnotation? Initializer? | "..." BindingIdentifier TypeAnnotation?
ParameterModifier = "readonly" [no LineTerminator here] | "public" [no LineTerminator here] | "private" [no LineTerminator here] | "protected" [no LineTerminator here]
TypeAnnotation = ":" Type
ReturnType = ":" Type
TypeParameters = "<" TypeParameterList ">"
TypeParameterList = TypeParameter | TypeParameterList "," TypeParameter
TypeParameter = BindingIdentifier | BindingIdentifier "extends" Type
TypeArguments = "<" TypeList ">"
TypeList = Type | TypeList "," Type
Type = UnionType | FunctionType
TypeNoEffect = UnionType | FunctionType
UnionType = IntersectionType | UnionType "|" IntersectionType
IntersectionType = PostfixType | IntersectionType "&" PostfixType
PostfixType = PrimaryType | PostfixType [no LineTerminator here] "[" "]" | PostfixType [no LineTerminator here] "[" Type "]" | "readonly" [no LineTerminator here] PostfixType | "keyof" [no LineTerminator here] PostfixType
PrimaryType = TypeReference | "(" Type ")" [lookahead ∉ { "=>" }] | ObjectType | TupleType | StringLiteral | NumericLiteral | "void" | "null" | "true" | "false" | "typeof" IdentifierReference
TypeReference = TypeName [lookahead ∉ { "<" }] | TypeName [no LineTerminator here] TypeArguments
TypeName = IdentifierReference | TypeName "." IdentifierName
TupleType = "[" "]" | "[" TypeList "]"
FunctionType = TypeParameters? "(" FormalParameters ")" "=>" Type
ObjectType = "{" "}" | "{" TypeMemberList TypeMemberEnd? "}"
TypeMemberList = TypeMember | TypeMemberList TypeMemberSeparator TypeMember
TypeMemberSeparator = ";" | "," | LineTerminator
TypeMemberEnd = ";" | ","
TypeMember = PropertySignature | MethodSignature
PropertySignature = PropertyName "?"? TypeAnnotation? | "readonly" [no LineTerminator here] PropertyName "?"? TypeAnnotation?
MethodSignature = PropertyName "?"? TypeParameters? "(" FormalParameters ")" TypeAnnotation?
ClassElementName = PropertyName | "#" IdentifierName
GeneratorExpression = "function" "*" BindingIdentifier? TypeParameters? "(" FormalParameters ")" TypeAnnotation? Block
AsyncFunctionExpression = "async" [no LineTerminator here] "function" BindingIdentifier? TypeParameters? "(" FormalParameters ")" TypeAnnotation? Block
AsyncGeneratorExpression = "async" [no LineTerminator here] GeneratorExpression
Name = BindingIdentifier
`

// grammarSubsetHooks says where the subset admits each Appendix A production that
// no other production names, by the alternatives ECMAScript gives the
// construct it mirrors: an effect function stands where an async function
// does, try where await does, a VibeLang statement where a statement does,
// and A!E!R where a type does. A production comment such as "(a
// PrimaryExpression)" or "(where ECMAScript has AwaitExpression)" overrides
// the table.
var grammarSubsetHooks = []struct{ at, name string }{
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
	{regexp.MustCompile(`^a type at TypeScript.s type-operator level`), "PostfixType", "TypeScript type-operator level"},
	{regexp.MustCompile(`^a Type that is not an unparenthesized EffectType`), "TypeNoEffect", "Type without the EffectType alternative"},
	{regexp.MustCompile(`^the class-member modifiers TypeScript allows before async`), "ClassMemberModifiers", ""},
	{regexp.MustCompile(`^the head of ECMAScript's for…of before "of"`), "ForOfHead", ""},
	{regexp.MustCompile(`^(a non-static MethodDeclaration|TypeScript's MethodDeclaration, without static)`), "NonStaticMethod", ""},
	{regexp.MustCompile(`^(a non-static get accessor|TypeScript's get accessor, without static)`), "GetAccessor", ""},
	{regexp.MustCompile(`^a LineTerminator before the next token`), "LineTerminator", ""},
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
	defined := map[string]bool{}
	for _, d := range a.defs {
		defined[d.name] = true
	}
	for _, l := range strings.Split(grammarTsSubset, "\n") {
		if m := production.FindStringSubmatch(l); m != nil && !defined[m[1]] {
			defs = append(defs, tsDefs[m[1]])
		}
	}
	defs = append(defs, a.defs...)
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
	return g.parameterize()
}

// grammarEffectBodies are the subset's function-like productions, whose parameters
// and body are parsed with [~Effect], as ECMAScript parses a nested plain
// function's with [~Await].
var grammarEffectBodies = map[string]bool{"FunctionDeclaration": true, "FunctionExpression": true, "ArrowFunction": true, "AsyncArrowFunction": true, "MethodDefinition": true, "GetAccessor": true, "NonStaticMethod": true}

// parameterize gives every nonterminal its two copies, N and N[+Effect]
// (written N⁺), the way ECMAScript parameterizes [Await]: after the token
// "effect" in a rule (an effect function, arrow, method, producer or block)
// the rest of the rule is effect code; a plain function's parts are not; and
// everything else keeps the parameter of the code around it.
func (g *grammarCfg) parameterize() *grammarCfg {
	h := &grammarCfg{index: map[string]int{}, ordered: map[int]bool{}, vibe: map[int]bool{}, helper: map[int]bool{}, prose: g.prose, unresolved: g.unresolved, hooks: g.hooks, comments: g.comments}
	idx := func(nt int, e bool) int {
		name := g.names[nt]
		if e {
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
		idx(nt, false)
		idx(nt, true)
	}
	for _, r := range g.rules {
		owner := g.names[r.lhs]
		if at := strings.IndexAny(owner, "#:"); at > 0 {
			owner = owner[:at]
		}
		plain := !r.vibe && grammarEffectBodies[owner]
		for _, e := range []bool{false, true} {
			rhs := slices.Clone(r.rhs)
			child := e && !plain
			for k := range rhs {
				s := &rhs[k]
				if s.kind == grammarSymTok && s.text == "effect" {
					child = true
				}
				s.eff = e
				if s.kind == grammarSymNT {
					s.eff = child
					s.nt = idx(s.nt, child)
					s.text = h.names[s.nt]
				}
			}
			h.add(idx(r.lhs, e), rhs, r.src, r.vibe)
		}
	}
	h.start, h.startE = idx(g.start, false), idx(g.start, true)
	h.analyze()
	return h
}

// named returns both copies of a nonterminal.
func (g *grammarCfg) named(name string) []int {
	var out []int
	for _, n := range []string{name, name + "⁺"} {
		if i, ok := g.index[n]; ok {
			out = append(out, i)
		}
	}
	return out
}

// base is a nonterminal's name without its parameter.
func (g *grammarCfg) base(nt int) string {
	return strings.TrimSuffix(g.names[nt], "⁺")
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
			s = grammarGsym{kind: grammarSymNT, text: e.name}
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

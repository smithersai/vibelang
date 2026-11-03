package vibelangestree

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The tokens and comments come from one scan of the source text, so every
// token ESLint sees is one the author wrote, in order, whatever the parser
// synthesized. The scanner cannot tell a regular expression from a division,
// the } that continues a template from a block's, or >> from two type
// argument lists closing; the tree can, so the scan rescans where the tree
// has a regular expression, a template continuation, or a shift or
// comparison operator. Adjacent generic openings, <<, need the inverse:
// split them unless the tree records an actual left-shift operator.

// jsxLexeme is a source span the ordinary TypeScript scan cannot tokenize.
type jsxLexeme struct {
	end int
	typ string
}

// lexicalContext is what the scan needs from the tree.
type lexicalContext struct {
	jsx         map[int]jsxLexeme
	regexps     map[int]bool
	templates   map[int]bool
	greaters    map[int]bool
	leftShifts  map[int]bool
	pipes       map[int]bool
	identifiers map[int]bool
}

func newLexicalContext() *lexicalContext {
	return &lexicalContext{
		jsx:         map[int]jsxLexeme{},
		regexps:     map[int]bool{},
		templates:   map[int]bool{},
		greaters:    map[int]bool{},
		leftShifts:  map[int]bool{},
		pipes:       map[int]bool{},
		identifiers: map[int]bool{},
	}
}

// collect walks file and records where the scan must rescan.
func (l *lexicalContext) collect(file *ast.SourceFile, text string) {
	start := func(n *ast.Node) int { return scanner.SkipTrivia(text, n.Pos()) }
	var name func(*ast.Node)
	name = func(n *ast.Node) {
		switch n.Kind {
		case ast.KindPropertyAccessExpression:
			name(n.Expression())
			name(n.Name())
		case ast.KindJsxNamespacedName:
			// typescript-estree leaves the namespaced name's leaf
			// tokens as Identifier, including hyphenated names.
			ns := n.AsJsxNamespacedName().Namespace
			l.jsx[start(ns)] = jsxLexeme{ns.End(), "Identifier"}
			local := n.Name()
			l.jsx[start(local)] = jsxLexeme{local.End(), "Identifier"}
		case ast.KindIdentifier:
			l.jsx[start(n)] = jsxLexeme{n.End(), "JSXIdentifier"}
		}
	}
	jsxDepth := 0
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Kind >= ast.KindJsxElement && n.Kind <= ast.KindJsxAttribute {
			jsxDepth++
			defer func() { jsxDepth-- }()
		}
		if n.Pos() < 0 {
			return n.ForEachChild(visit)
		}
		switch n.Kind {
		case ast.KindJsxOpeningElement, ast.KindJsxSelfClosingElement, ast.KindJsxClosingElement:
			name(n.TagName())
		case ast.KindJsxAttribute:
			name(n.Name())
			if value := n.Initializer(); value != nil && value.Kind == ast.KindStringLiteral {
				l.jsx[start(value)] = jsxLexeme{value.End(), "JSXText"}
			}
		case ast.KindJsxText, ast.KindJsxTextAllWhiteSpaces:
			if n.End() > n.Pos() {
				l.jsx[n.Pos()] = jsxLexeme{n.End(), "JSXText"}
			}
		case ast.KindRegularExpressionLiteral:
			l.regexps[start(n)] = true
		case ast.KindTemplateMiddle, ast.KindTemplateTail:
			l.templates[start(n)] = true
		case ast.KindBinaryExpression:
			operator := n.AsBinaryExpression().OperatorToken
			switch operator.Kind {
			case ast.KindLessThanLessThanToken:
				l.leftShifts[start(operator)] = true
			case ast.KindGreaterThanGreaterThanToken, ast.KindGreaterThanGreaterThanGreaterThanToken,
				ast.KindGreaterThanEqualsToken, ast.KindGreaterThanGreaterThanEqualsToken,
				ast.KindGreaterThanGreaterThanGreaterThanEqualsToken:
				l.greaters[start(operator)] = true
			case ast.KindBarToken:
				if n.Flags&ast.NodeFlagsVibeLang != 0 {
					l.pipes[start(operator)] = true
				}
			}
		case ast.KindPropertyAccessExpression:
			// Match typescript-estree's hasJSXAncestor token rule even
			// for a property access inside a JSX expression container.
			if jsxDepth > 0 {
				for _, id := range []*ast.Node{n.Expression(), n.Name()} {
					if id.Kind == ast.KindIdentifier && !synthesized(id) {
						l.jsx[start(id)] = jsxLexeme{id.End(), "JSXIdentifier"}
					}
				}
			}
			// x |> f(%)(…) parses as x.pipe(f(…)) whose pipe stands on |.
			name := n.AsPropertyAccessExpression().Name()
			if name.Flags&ast.NodeFlagsReparsed != 0 && name.Kind == ast.KindIdentifier && name.Text() == "pipe" {
				l.pipes[start(name)] = true
			}
		case ast.KindIdentifier:
			// A pipe's topic, %, is an identifier the parser flags; its token is %.
			if n.Flags&ast.NodeFlagsReparsed == 0 && n.Flags&ast.NodeFlagsVibeLang == 0 {
				l.identifiers[start(n)] = true
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// lex scans text into ESTree tokens and comments.
func lex(text string, l *lexicalContext) (tokens []*obj, comments []*obj) {
	s := scanner.NewScanner()
	s.SetText(text)
	s.SetSkipTrivia(false)
	// A JSX text span can start with whitespace or comment-looking text.
	// Consume it before the ordinary scanner skips or interprets anything.
	jsx := func(start int) bool {
		lexeme, ok := l.jsx[start]
		if !ok {
			return false
		}
		tokens = append(tokens, (&obj{}).set("type", lexeme.typ).
			set("value", text[start:lexeme.end]).set("range", span{start, lexeme.end}))
		s.ResetPos(lexeme.end)
		return true
	}
	for {
		if jsx(s.TokenEnd()) {
			continue
		}
		kind := s.Scan()
		if kind == ast.KindEndOfFile {
			break
		}
		start, end := s.TokenStart(), s.TokenEnd()
		if jsx(start) {
			continue
		}
		switch kind {
		case ast.KindWhitespaceTrivia, ast.KindNewLineTrivia, ast.KindConflictMarkerTrivia:
			continue
		case ast.KindSingleLineCommentTrivia:
			comments = append(comments, (&obj{}).set("type", "Line").set("value", text[start+2:end]).set("range", span{start, end}))
			continue
		case ast.KindMultiLineCommentTrivia:
			value := text[start+2 : max(end-2, start+2)]
			if !strings.HasSuffix(text[start:end], "*/") || end-start < 4 {
				value = text[start+2 : end]
			}
			comments = append(comments, (&obj{}).set("type", "Block").set("value", value).set("range", span{start, end}))
			continue
		case ast.KindSlashToken, ast.KindSlashEqualsToken:
			if l.regexps[start] {
				kind = s.ReScanSlashToken()
			}
		case ast.KindCloseBraceToken:
			if l.templates[start] {
				kind = s.ReScanTemplateToken(false)
			}
		case ast.KindLessThanLessThanToken:
			if !l.leftShifts[start] {
				kind = s.ReScanLessThanToken()
			}
		case ast.KindGreaterThanToken:
			if l.greaters[start] {
				kind = s.ReScanGreaterThanToken()
			}
		case ast.KindBarToken:
			if l.pipes[start] && strings.HasPrefix(text[start:], "|>") {
				s.Scan() // the > of |>: ESLint sees the pipe operator as one token
				tokens = append(tokens, token(text, kind, start, start+2, false))
				continue
			}
		}
		start, end = s.TokenStart(), s.TokenEnd()
		tokens = append(tokens, token(text, kind, start, end, l.identifiers[start]))
	}
	return tokens, comments
}

func token(text string, kind ast.Kind, start, end int, identifier bool) *obj {
	value := text[start:end]
	t := (&obj{}).set("type", tokenType(kind, identifier, value))
	switch t.typ() {
	case "RegularExpression":
		slash := strings.LastIndex(value, "/")
		if slash > 0 {
			t.set("regex", (&obj{}).set("flags", value[slash+1:]).set("pattern", value[1:slash]))
		}
	case "PrivateIdentifier":
		value = strings.TrimPrefix(value, "#")
	}
	return t.set("value", value).set("range", span{start, end})
}

// tokenType classifies a token as typescript-estree's getTokenType does for
// the token the tree holds there.
func tokenType(kind ast.Kind, identifier bool, value string) string {
	if value == "|>" {
		return "Punctuator"
	}
	if identifier && kind != ast.KindPrivateIdentifier {
		return "Identifier"
	}
	switch {
	case kind == ast.KindNullKeyword:
		return "Null"
	case kind >= ast.KindFirstKeyword && kind <= ast.KindLastFutureReservedWord:
		if kind == ast.KindTrueKeyword || kind == ast.KindFalseKeyword {
			return "Boolean"
		}
		return "Keyword"
	case kind >= ast.KindFirstPunctuation && kind <= ast.KindLastPunctuation:
		return "Punctuator"
	case kind >= ast.KindNoSubstitutionTemplateLiteral && kind <= ast.KindTemplateTail:
		return "Template"
	}
	switch kind {
	case ast.KindNumericLiteral, ast.KindBigIntLiteral:
		return "Numeric"
	case ast.KindPrivateIdentifier:
		return "PrivateIdentifier"
	case ast.KindStringLiteral:
		return "String"
	case ast.KindRegularExpressionLiteral:
		return "RegularExpression"
	}
	return "Identifier"
}

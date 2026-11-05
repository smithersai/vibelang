package vibelangmapper

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// errorExtractorFlow preserves D215 for stock TypeScript: an error extractor
// is an instanceof test and extracts precisely [subject]. These are checking
// witnesses only. Execution keeps the original extraction, length and element
// reads, so a direct subject with a getter is not evaluated extra times.
func (w *printer) errorExtractorFlow(n *ast.Node, e env) bool {
	var call *ast.Node
	var checking string
	switch n.Kind {
	case ast.KindBinaryExpression:
		b := n.AsBinaryExpression()
		if b.OperatorToken.Flags&ast.NodeFlagsReparsed == 0 {
			return false
		}
		if b.OperatorToken.Kind == ast.KindExclamationEqualsEqualsToken && b.Right.Kind == ast.KindFalseKeyword {
			call = w.errorExtraction(b.Left)
			if call != nil {
				checking = "(" + w.patternText(call.Arguments()[1], e) + " instanceof " + w.patternText(call.Arguments()[0], e) + ")"
			}
		} else if ast.IsPropertyAccessExpression(b.Left) && b.Left.Name().Text() == "length" && b.Right.Kind == ast.KindNumericLiteral {
			call = w.errorExtraction(b.Left.Expression())
			if call != nil {
				length, err := strconv.Atoi(b.Right.Text())
				if err != nil {
					return false
				}
				switch b.OperatorToken.Kind {
				case ast.KindEqualsEqualsEqualsToken:
					checking = strconv.FormatBool(length == 1)
				case ast.KindGreaterThanEqualsToken:
					checking = strconv.FormatBool(length <= 1)
				}
			}
		}
	case ast.KindElementAccessExpression:
		index := n.AsElementAccessExpression().ArgumentExpression
		if index.Kind == ast.KindNumericLiteral && index.Text() == "0" {
			call = w.errorExtraction(n.Expression())
			if call != nil {
				checking = w.patternText(call.Arguments()[1], e)
			}
		}
	case ast.KindIdentifier:
		// A rest pattern also reads the tuple itself (slice). Its declaration
		// name must still declare the original temporary.
		if n.Parent != nil && ast.IsVariableDeclaration(n.Parent) && n.Parent.Name() == n {
			return false
		}
		call = w.errorExtraction(n)
		if call != nil {
			checking = "([" + w.patternText(call.Arguments()[1], e) + "] as const)"
		}
	}
	if checking == "" {
		return false
	}
	old := w.runtimeText
	w.runtimeText = true
	runtime := w.patternText(n, e)
	w.runtimeText = old
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{checking, runtime}})
	return true
}

// errorExtraction resolves only local error declarations. A custom matcher
// or a shadowed class name makes no promise about its extracted values.
func (w *printer) errorExtraction(n *ast.Node) *ast.Node {
	r := w.p.forms.(*Resolver)
	if ast.IsIdentifier(n) {
		if n.Flags&ast.NodeFlagsReparsed == 0 {
			return nil
		}
		d := r.binding(n, n.Text())
		if d == nil || !ast.IsVariableDeclaration(d) {
			return nil
		}
		n = d.Initializer()
	}
	if n == nil || !ast.IsCallExpression(n) || len(n.Arguments()) != 2 {
		return nil
	}
	callee := n.Expression()
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsReparsed == 0 || callee.Text() != "$extract" {
		return nil
	}
	matcher := n.Arguments()[0]
	if !ast.IsIdentifier(matcher) {
		return nil
	}
	decl := r.binding(matcher, matcher.Text())
	if decl == nil || !isErrorDeclaration(decl) {
		return nil
	}
	return n
}

// patternText prints a parser-written test or path without applying another
// checking witness. Helpers and fresh temporary names are resolved normally;
// a chunk the renderings write differently, such as a capture's read
// (captures.go), is written as the checking rendering writes it, or as the
// executable one does when runtimeText is set.
func (w *printer) patternText(n *ast.Node, e env) string {
	start := len(w.chunks)
	old := w.rawExtraction
	w.rawExtraction = true
	w.node(n, e)
	w.rawExtraction = old
	parts := w.chunks[start:]
	w.chunks = w.chunks[:start]
	var text strings.Builder
	for _, c := range parts {
		switch {
		case c.node != nil:
			text.WriteString(w.p.text[w.p.tokenStart(c.node):c.node.End()])
		case c.kind == editPatternFlow && w.runtimeText:
			text.WriteString(c.fields[1])
		case c.kind == editPatternFlow:
			text.WriteString(c.fields[0])
		default:
			text.WriteString(c.text)
		}
	}
	return text.String()
}

// Native TypeScript checks the ordinary path; executable projection shares
// the cache that the native emitter uses, without rereading a getter for flow.
func (w *printer) cachedPropertyFlow(n *ast.Node, e env) bool {
	if !w.propertyCachesLoaded {
		w.propertyCaches = parser.MatchPropertyCaches(w.p.file)
		w.propertyCachesLoaded = true
	}
	cache := w.propertyCaches[n]
	if cache == nil {
		return false
	}
	oldRaw := w.rawPropertyCache
	w.rawPropertyCache = true
	checking := w.patternText(n, e)
	w.rawPropertyCache = oldRaw
	method := "get"
	var subject *ast.Node
	var key string
	oldRuntime := w.runtimeText
	w.runtimeText = true
	switch n.Kind {
	case ast.KindBinaryExpression:
		method = "propertyHas"
		b := n.AsBinaryExpression()
		subject, key = b.Right, w.patternText(b.Left, e)
	case ast.KindPropertyAccessExpression:
		subject = n.Expression()
		key = strconv.Quote(n.Name().Text())
	case ast.KindElementAccessExpression:
		subject = n.Expression()
		key = w.patternText(n.AsElementAccessExpression().ArgumentExpression, e)
	}
	runtime := w.identifier(cache) + "." + method + "(" + w.patternText(subject, e) + ", " + key + ")"
	w.runtimeText = oldRuntime
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{checking, runtime}})
	return true
}

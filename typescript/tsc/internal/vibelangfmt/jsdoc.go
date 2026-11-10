package vibelangfmt

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Comment interiors include content-bearing empty lines and code fences.
// Give the host an opaque comment, then restore its original interior with
// only the indentation of its containing line changed.
func formatWithComments(text string, kind core.ScriptKind, host TypeScriptFormatter) (string, error) {
	ranges := blockCommentRanges(text, kind)
	protected := ranges[:0]
	for _, span := range ranges {
		raw := text[span.Pos():span.End()]
		// Keep the host's ignore directives visible, including block spellings.
		body := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw[2:len(raw)-2]), "*"))
		if body == "dprint-ignore" || body == "dprint-ignore-file" {
			continue
		}
		if strings.HasPrefix(raw, "/**") || strings.ContainsAny(raw, "\r\n") {
			protected = append(protected, span)
		}
	}
	ranges = protected
	if len(ranges) == 0 {
		return host(text)
	}
	sentinel := "vibelang_doc_"
	for strings.Contains(text, sentinel) {
		sentinel += "_"
	}
	var masked strings.Builder
	cursor := 0
	docs := make(map[string]placeholder, len(ranges))
	for i, span := range ranges {
		marker := sentinel + strconv.Itoa(i)
		raw := text[span.Pos():span.End()]
		docs[marker] = placeholder{text: raw, indent: lineIndent(text, span.Pos())}
		masked.WriteString(text[cursor:span.Pos()])
		if strings.ContainsAny(raw, "\r\n") {
			opening := "/*"
			if strings.HasPrefix(raw, "/**") {
				opening = "/**"
			}
			masked.WriteString(opening + "\n * " + marker + "\n */")
		} else {
			masked.WriteString("/** " + marker + " */")
		}
		cursor = span.End()
	}
	masked.WriteString(text[cursor:])
	formatted, err := host(masked.String())
	if err != nil {
		return "", err
	}
	var restored strings.Builder
	cursor = 0
	for _, span := range blockCommentRanges(formatted, kind) {
		raw := formatted[span.Pos():span.End()]
		body := raw[2 : len(raw)-2]
		if strings.HasPrefix(raw, "/**") {
			body = strings.TrimPrefix(body, "*")
		}
		marker := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(body), "*"))
		doc, ok := docs[marker]
		if !ok {
			continue
		}
		restored.WriteString(formatted[cursor:span.Pos()])
		d := decoder{text: formatted}
		// Follow the host's newline option without changing the line structure.
		doc.text = strings.ReplaceAll(doc.text, "\r\n", "\n")
		raw = d.reindent(doc, span.Pos())
		if strings.Contains(formatted, "\r\n") {
			raw = strings.ReplaceAll(raw, "\n", "\r\n")
		}
		restored.WriteString(raw)
		cursor = span.End()
		delete(docs, marker)
	}
	if len(docs) != 0 {
		return "", fmt.Errorf("vibelang format: the TypeScript formatter lost a documentation comment")
	}
	restored.WriteString(formatted[cursor:])
	return restored.String(), nil
}

// Scanner rescans follow the parsed TypeScript context, so comment-looking
// text in regexps, template tails and JSX children is never documentation.
func blockCommentRanges(text string, kind core.ScriptKind) []core.TextRange {
	file := parser.ParseSourceFile(projectionOptions(kind), text, kind)
	regexps, templates, jsx := map[int]int{}, map[int]bool{}, map[int]int{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindRegularExpressionLiteral:
			regexps[scanner.SkipTrivia(text, node.Pos())] = node.End()
		case ast.KindTemplateMiddle, ast.KindTemplateTail:
			templates[scanner.SkipTrivia(text, node.Pos())] = true
		case ast.KindJsxText:
			jsx[node.Pos()] = node.End()
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	s := scanner.NewScanner()
	s.SetText(text)
	s.SetSkipTrivia(false)
	var result []core.TextRange
	for {
		if end, ok := jsx[s.TokenEnd()]; ok && end > s.TokenEnd() {
			s.ResetPos(end)
			continue
		}
		token := s.Scan()
		if token == ast.KindEndOfFile {
			break
		}
		start := s.TokenStart()
		if end, ok := jsx[start]; ok {
			s.ResetPos(end)
			continue
		}
		if end, ok := regexps[start]; ok {
			s.ResetPos(end)
			continue
		}
		if token == ast.KindCloseBraceToken && templates[start] {
			s.ReScanTemplateToken(false)
			continue
		}
		if token == ast.KindMultiLineCommentTrivia {
			result = append(result, core.NewTextRange(start, s.TokenEnd()))
		}
	}
	return result
}

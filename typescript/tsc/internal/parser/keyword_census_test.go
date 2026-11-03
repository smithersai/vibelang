package parser

import (
	"fmt"
	goast "go/ast"
	goparser "go/parser"
	gotoken "go/token"
	"regexp"
	"slices"
	"strconv"
	"testing"
)

var censusWord = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// parserKeywordReads counts executable comparisons, not examples in comments
// or strings. A scanner's string-literal data is not an identifier keyword.
func parserKeywordReads(source string) ([]string, error) {
	file, err := goparser.ParseFile(gotoken.NewFileSet(), "parser.go", source, 0)
	if err != nil {
		return nil, err
	}
	parents := map[goast.Node]goast.Node{}
	var stack []goast.Node
	goast.Inspect(file, func(n goast.Node) bool {
		if n == nil {
			stack = stack[:len(stack)-1]
			return false
		}
		if len(stack) > 0 {
			parents[n] = stack[len(stack)-1]
		}
		stack = append(stack, n)
		return true
	})
	var words []string
	add := func(n goast.Node, value goast.Expr, receiver string) {
		lit, ok := value.(*goast.BasicLit)
		if !ok || lit.Kind != gotoken.STRING {
			return
		}
		word, err := strconv.Unquote(lit.Value)
		if err != nil || !censusWord.MatchString(word) {
			return
		}
		for child, parent := n, parents[n]; parent != nil; child, parent = parent, parents[parent] {
			if _, ok := parent.(*goast.ParenExpr); ok {
				continue
			}
			if b, ok := parent.(*goast.BinaryExpr); ok && b.Op == gotoken.LAND {
				other := b.X
				if b.X == child {
					other = b.Y
				}
				if censusStringGuard(other, receiver) {
					return
				}
			}
			// Do not infer a guard across other operations: an intervening
			// parser call could have advanced to a different token.
			break
		}
		words = append(words, word)
	}
	goast.Inspect(file, func(n goast.Node) bool {
		if b, ok := n.(*goast.BinaryExpr); ok && b.Op == gotoken.EQL {
			for _, pair := range [][2]goast.Expr{{b.X, b.Y}, {b.Y, b.X}} {
				call, ok := pair[0].(*goast.CallExpr)
				if !ok || len(call.Args) != 0 {
					continue
				}
				selector, ok := call.Fun.(*goast.SelectorExpr)
				if !ok || selector.Sel.Name != "TokenValue" {
					continue
				}
				receiver := ""
				if scanner, ok := selector.X.(*goast.SelectorExpr); ok && scanner.Sel.Name == "scanner" {
					if id, ok := scanner.X.(*goast.Ident); ok {
						receiver = id.Name
					}
				}
				add(b, pair[1], receiver)
			}
		}
		if call, ok := n.(*goast.CallExpr); ok && len(call.Args) == 1 {
			if selector, ok := call.Fun.(*goast.SelectorExpr); ok && selector.Sel.Name == "isMatchWord" {
				add(call, call.Args[0], "")
			}
		}
		return true
	})
	return words, nil
}

func censusStringGuard(expr goast.Expr, receiver string) bool {
	if receiver == "" {
		return false
	}
	if p, ok := expr.(*goast.ParenExpr); ok {
		return censusStringGuard(p.X, receiver)
	}
	b, ok := expr.(*goast.BinaryExpr)
	if !ok {
		return false
	}
	if b.Op != gotoken.EQL {
		return false
	}
	for _, pair := range [][2]goast.Expr{{b.X, b.Y}, {b.Y, b.X}} {
		field, ok := pair[0].(*goast.SelectorExpr)
		if !ok || field.Sel.Name != "token" {
			continue
		}
		id, ok := field.X.(*goast.Ident)
		if !ok || id.Name != receiver {
			continue
		}
		kind, ok := pair[1].(*goast.SelectorExpr)
		if ok && kind.Sel.Name == "KindStringLiteral" {
			return true
		}
	}
	return false
}

func TestParserKeywordCensus(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       []string
	}{
		{"keyword", `return p.scanner.TokenValue()=="effect"`, []string{"effect"}},
		{"quoted-constructor", `return p.token==ast.KindStringLiteral && p.scanner.TokenValue()=="constructor"`, nil},
		{"reverse-guard", `return p.scanner.TokenValue()=="constructor" && p.token==ast.KindStringLiteral`, nil},
		{"native-constructor", `return class && (p.token==ast.KindConstructorKeyword || p.token==ast.KindStringLiteral && p.scanner.TokenValue()=="constructor")`, nil},
		{"identifier-path", `return (p.token==ast.KindStringLiteral || p.token==ast.KindIdentifier) && p.scanner.TokenValue()=="effect"`, []string{"effect"}},
		{"advanced-token", `return p.token==ast.KindStringLiteral && p.advance() && p.scanner.TokenValue()=="effect"`, []string{"effect"}},
		{"nested-advance", `return p.token==ast.KindStringLiteral && (p.advance() && p.scanner.TokenValue()=="effect")`, []string{"effect"}},
		{"different-parser", `return q.token==ast.KindStringLiteral && p.scanner.TokenValue()=="effect"`, []string{"effect"}},
		{"match-helper", `return p.isMatchWord("when")`, []string{"when"}},
		{"comment", `/* p.scanner.TokenValue()=="invented" */ return true`, nil},
		{"source-string", `const sample = "p.scanner.TokenValue()==\"invented\""; return true`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parserKeywordReads("package parser;func f(){" + tc.body + "}")
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(got, tc.want) {
				t.Fatalf("got%v want%v", got, tc.want)
			}
		})
	}
}

func FuzzParserKeywordCensus(f *testing.F) {
	for _, word := range []string{"effect", "constructor", "service", "when", "field_1"} {
		f.Add(word)
	}
	f.Fuzz(func(t *testing.T, word string) {
		if len(word) > 64 || !censusWord.MatchString(word) {
			return
		}
		quoted := fmt.Sprintf("package parser;func f(){return p.token==ast.KindStringLiteral && p.scanner.TokenValue()==%q}", word)
		got, err := parserKeywordReads(quoted)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 0 {
			t.Fatalf("quoted data became keyword: %q ->%v", word, got)
		}
		keyword := fmt.Sprintf("package parser;func f(){return p.scanner.TokenValue()==%q}", word)
		got, err = parserKeywordReads(keyword)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(got, []string{word}) {
			t.Fatalf("lost identifier comparison: %q ->%v", word, got)
		}
	})
}

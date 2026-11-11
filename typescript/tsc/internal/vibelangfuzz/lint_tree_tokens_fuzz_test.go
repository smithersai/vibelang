package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangestree"
)

// FuzzLintTreeTokens checks that the nodes the parser generates for patterns,
// match and do keep the tokens ESLint's rules read.
//
// Chapter 7, Formatting and existing tools: "Type checkers use `.d.vibe.ts`;
// linters, Knip, bundlers and test runners read `.vibe`." ESLint reads a
// `.vibe` file through the lint tree (vibelangestree), whose tokens are the
// ones the author wrote. Its core rules look for an arrow's `=>`
// (arrow-spacing), a declarator's or an assignment's operator
// (space-infix-ops, operator-linebreak, indent), a call's parentheses
// (function-paren-newline, comma-dangle, indent) and a unary operator
// (no-div-regex, wrap-regex) among a node's tokens, and a rule that finds
// none throws, which stops the whole lint run. The tree of a `.ts` file has
// every one of these tokens; the twin forms check that the oracle holds
// there, so a failure belongs to the `.vibe` tree. The `!` and the
// comparisons and joins of a pattern's tests are pinned by vibelangestree's
// own tests and are not checked here.
const lintTreeTarget = "FuzzLintTreeTokens"

const lintTreeQuote = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."

func TestLintTreeTokensQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", lintTreeQuote)
}

// lintTreeChecks names each token check and the token it looks for.
var lintTreeChecks = []struct{ name, token string }{
	{"arrow", "an arrow's =>"},
	{"assignment", "an assignment's operator"},
	{"call", "a call's parentheses"},
	{"declarator", "a declarator's ="},
	{"unary", "a unary operator"},
}

// lintTreeForm is a source form: an expression placed in each expression
// home, or statements placed directly in a function body. A twin is
// TypeScript, parsed as main.ts.
type lintTreeForm struct {
	key, text       string
	statement, twin bool
}

var lintTreeForms = []lintTreeForm{
	{key: "in-place/literal", text: "x is 1"},
	{key: "in-place/not", text: "x is not 1"},
	{key: "in-place/member", text: `x.y is "a"`},
	{key: "in-place/null", text: "x is null"},
	{key: "in-place/instanceof", text: "x is instanceof Map"},
	{key: "in-place/relation", text: "x is == 1"},
	{key: "captured/or", text: "x is 1 or 2"},
	{key: "captured/call-subject", text: "g() is 1"},
	{key: "captured/guard", text: "x is if (x > 1)"},
	{key: "captured/member-or", text: `x.y is "a" or null`},
	{key: "captured/not-group", text: "x is not (1 or 2)"},
	{key: "relation/greater", text: "x is > 1"},
	{key: "relation/and", text: "x is 1 and > 0"},
	{key: "type/constructor", text: "x is String"},
	{key: "type/or", text: "x is Number or String"},
	{key: "object/flat", text: "x is { a: 2 }"},
	{key: "object/nested", text: "x is { a: { b: 1 } }"},
	{key: "list/pair", text: "x is [1, 2]"},
	{key: "list/rest", text: "x is [1, ...]"},
	{key: "object-or-list", text: "x is { a: 1 } or [1]"},
	{key: "bind/name", text: "if (x is let a) {\n    return a\n  }\n  return 0", statement: true},
	{key: "bind/object", text: "if (x is { a: let a }) {\n    return a\n  }\n  return 0", statement: true},
	{key: "bind/while", text: "while (x is { next: let n }) {\n    x = n\n  }\n  return x", statement: true},
	{key: "bind/list", text: "if (x is [let a, 2]) {\n    return a\n  }\n  return 0", statement: true},
	{key: "match/literal", text: "return match (x) {\n    when 1: 1;\n    default: 0;\n  }", statement: true},
	{key: "match/or", text: "return match (x) {\n    when 1: 1;\n    when \"a\" or null: 2;\n    default: 0;\n  }", statement: true},
	{key: "match/object-binding", text: "return match (x) {\n    when { a: let a }: a;\n    default: 0;\n  }", statement: true},
	{key: "match/list-binding", text: "return match (x) {\n    when [let b, 2]: b;\n    default: 0;\n  }", statement: true},
	{key: "match/type-relation", text: "return match (x) {\n    when String: 1;\n    when > 2: 2;\n    default: 0;\n  }", statement: true},
	{key: "do-match/literal", text: "return do {\n    match (x) {\n      when 1: 1;\n      default: 0;\n    }\n  }", statement: true},
	{key: "do-match/object", text: "return do {\n    match (x) {\n      when { a: 2 }: 3;\n      default: 0;\n    }\n  }", statement: true},
	{key: "twin/or", text: "x === 1 || x === 2", twin: true},
	{key: "twin/arrow-call", text: "((v) => v === 1)(x)", twin: true},
	{key: "twin/typeof", text: `typeof x === "string" && !(x instanceof Map)`, twin: true},
	{key: "twin/object", text: `typeof x === "object" && x !== null && x.a === 2`, twin: true},
	{key: "twin/statements", text: "const { a } = x\n  let b = a\n  b += 1\n  b = g(b, -1)\n  return a === b ? void a : ~b", statement: true, twin: true},
	{key: "twin/switch", text: "switch (x) {\n    case 1:\n      return 1\n    default:\n      return 0\n  }", statement: true, twin: true},
}

// An expression form takes the place of %s in a home.
var lintTreeHomes = []struct{ key, text string }{
	{"return", "return %s"},
	{"if", "if (%s) {\n    return 1\n  }\n  return 0"},
	{"while", "while (%s) {\n    x = x.next\n  }\n  return x"},
	{"const", "const r = %s\n  return r"},
	{"argument", "return g(%s, 1)"},
	{"arrow", "const h = () => %s\n  return h"},
	{"conditional", "return (%s) ? 1 : 0"},
}

// A variant picks the trivia before the file and the function the body is in.
var lintTreePrefixes = []string{"", "// é 😀\n", "/* 😀 */\r\n", "\xef\xbb\xbf"}

var lintTreeContainers = []string{
	"export function f(x, g) {\n  %s\n}\n",
	"export class C {\n  m(x, g) {\n  %s\n  }\n}\n",
	"export const f = (x, g) => {\n  %s\n}\n",
}

func lintTreeSource(form lintTreeForm, home string, variant uint8) string {
	body := form.text
	if !form.statement {
		for _, h := range lintTreeHomes {
			if h.key == home {
				body = strings.Replace(h.text, "%s", form.text, 1)
			}
		}
	}
	container := lintTreeContainers[int(variant/4)%len(lintTreeContainers)]
	return lintTreePrefixes[int(variant)%len(lintTreePrefixes)] + strings.Replace(container, "%s", body, 1)
}

type lintTreeToken struct {
	value      string
	start, end int
}

func lintTreeSpan(node map[string]any) (int, int) {
	r, _ := node["range"].([]any)
	if len(r) != 2 {
		return 0, 0
	}
	return int(r[0].(float64)), int(r[1].(float64))
}

func lintTreeChild(node map[string]any, key string) (map[string]any, bool) {
	child, ok := node[key].(map[string]any)
	return child, ok
}

// lintTreeBetween returns the tokens that lie within [start, end).
func lintTreeBetween(tokens []lintTreeToken, start, end int) []lintTreeToken {
	i := sort.Search(len(tokens), func(i int) bool { return tokens[i].start >= start })
	j := i
	for j < len(tokens) && tokens[j].end <= end {
		j++
	}
	return tokens[i:j]
}

func lintTreeHas(tokens []lintTreeToken, value string) bool {
	for _, token := range tokens {
		if token.value == value {
			return true
		}
	}
	return false
}

// lintTreeFlaws returns, for each check a node of tree fails, the first such
// node.
func lintTreeFlaws(tree map[string]any) map[string]string {
	var tokens []lintTreeToken
	for _, value := range tree["tokens"].([]any) {
		token := value.(map[string]any)
		start, end := lintTreeSpan(token)
		text, _ := token["value"].(string)
		tokens = append(tokens, lintTreeToken{text, start, end})
	}
	sort.SliceStable(tokens, func(i, j int) bool { return tokens[i].start < tokens[j].start })
	flaws := map[string]string{}
	add := func(check string, node map[string]any) {
		if _, seen := flaws[check]; !seen {
			start, end := lintTreeSpan(node)
			synthesized := ""
			if node["synthesized"] == true {
				synthesized = " synthesized"
			}
			flaws[check] = fmt.Sprintf("%v [%d,%d]%s", node["type"], start, end, synthesized)
		}
	}
	var visit func(value any)
	visit = func(value any) {
		switch v := value.(type) {
		case []any:
			for _, child := range v {
				visit(child)
			}
		case map[string]any:
			start, end := lintTreeSpan(v)
			switch v["type"] {
			case "ArrowFunctionExpression":
				from := start
				if params, _ := v["params"].([]any); len(params) > 0 {
					if last, ok := params[len(params)-1].(map[string]any); ok {
						_, from = lintTreeSpan(last)
					}
				}
				if body, ok := lintTreeChild(v, "body"); ok {
					bodyStart, _ := lintTreeSpan(body)
					if !lintTreeHas(lintTreeBetween(tokens, from, bodyStart), "=>") {
						add("arrow", v)
					}
				}
			case "VariableDeclarator":
				id, hasID := lintTreeChild(v, "id")
				if init, ok := lintTreeChild(v, "init"); ok && hasID {
					_, idEnd := lintTreeSpan(id)
					initStart, _ := lintTreeSpan(init)
					if !lintTreeHas(lintTreeBetween(tokens, idEnd, initStart), "=") {
						add("declarator", v)
					}
				}
			case "AssignmentExpression":
				left, okLeft := lintTreeChild(v, "left")
				right, okRight := lintTreeChild(v, "right")
				operator, _ := v["operator"].(string)
				if okLeft && okRight {
					_, leftEnd := lintTreeSpan(left)
					rightStart, _ := lintTreeSpan(right)
					if !lintTreeHas(lintTreeBetween(tokens, leftEnd, rightStart), operator) {
						add("assignment", v)
					}
				}
			case "CallExpression":
				if callee, ok := lintTreeChild(v, "callee"); ok {
					_, calleeEnd := lintTreeSpan(callee)
					inner := lintTreeBetween(tokens, start, end)
					if !lintTreeHas(lintTreeBetween(tokens, calleeEnd, end), "(") || len(inner) == 0 || inner[len(inner)-1].value != ")" {
						add("call", v)
					}
				}
			case "UnaryExpression":
				if operator, _ := v["operator"].(string); operator != "!" && operator != "typeof" {
					inner := lintTreeBetween(tokens, start, end)
					if len(inner) == 0 || inner[0].start != start || inner[0].value != operator {
						add("unary", v)
					}
				}
			}
			for key, child := range v {
				if key != "tokens" && key != "comments" && key != "range" && key != "loc" {
					visit(child)
				}
			}
		}
	}
	visit(tree["body"])
	return flaws
}

func FuzzLintTreeTokens(f *testing.F) {
	startShortBudget(f)
	for _, form := range lintTreeForms {
		homes := []string{"return"}
		if !form.statement {
			homes = nil
			for _, home := range lintTreeHomes {
				homes = append(homes, home.key)
			}
		}
		for _, home := range homes {
			for variant := uint8(0); variant < 12; variant++ {
				f.Add(form.key, home, variant)
			}
		}
	}
	keys := make([]string, len(lintTreeForms))
	for i, form := range lintTreeForms {
		keys[i] = form.key
	}
	f.Fuzz(func(t *testing.T, formKey, home string, variant uint8) {
		chapterSays(t, "007-tooling.md", lintTreeQuote)
		choice, _ := keyedChoice(keys, []byte(formKey))
		form := lintTreeForms[choice]
		source := lintTreeSource(form, home, variant)
		name := "main.vibe"
		if form.twin {
			name = "main.ts"
		}
		text, failure := vibelangestree.Parse(name, source)
		if failure != nil {
			t.Fatalf("%s does not parse: %v\n%s", form.key, failure, source)
		}
		var tree map[string]any
		if err := json.Unmarshal([]byte(text), &tree); err != nil {
			t.Fatal(err)
		}
		flaws := lintTreeFlaws(tree)
		if form.twin {
			if len(flaws) != 0 {
				t.Fatalf("the token oracle fails on the TypeScript twin %s: %v\n%s", form.key, flaws, source)
			}
			return
		}
		var pending []string
		for _, check := range lintTreeChecks {
			key := check.name + ":" + form.key
			_, isPending := Pending(lintTreeTarget, key)
			if node, failed := flaws[check.name]; failed {
				if !isPending {
					t.Errorf("%s %s: %s lacks %s among its tokens; the ESLint rules that read it throw\n%s", lintTreeTarget, key, node, check.token, source)
				}
				pending = append(pending, key+": "+node)
			} else {
				ExpectPending(t, lintTreeTarget, key)
			}
		}
		if len(pending) != 0 && !t.Failed() {
			t.Skipf("pending: %s", strings.Join(pending, "; "))
		}
		ExpectPending(t, lintTreeTarget, specCorpusKey(t))
	})
}

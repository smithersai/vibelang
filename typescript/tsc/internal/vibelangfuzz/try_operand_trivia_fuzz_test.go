package vibelangfuzz

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const tryOperandTarget = "FuzzTryOperandTrivia"
const tryOperandQuote = "TryExpression = [+Effect] \"try\" UnaryExpression   (where ECMAScript has AwaitExpression)"

func tryOperandChapter(t testing.TB) {
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), tryOperandQuote) {
		t.Fatalf("Appendix A no longer says %q", tryOperandQuote)
	}
}
func TestTryOperandTriviaQuoted(t *testing.T) { tryOperandChapter(t) }

func FuzzTryOperandTrivia(f *testing.F) {
	startShortBudget(f)
	tryOperandChapter(f)
	keys := []string{"member-plus", "member-call", "group", "computed-call", "optional-call", "value"}
	operands := []string{"obj.run() + 4", "obj.run()", "(obj.run())", "obj[\"run\"]()", "obj?.run()", "program"}
	trivia := []string{" ", "\n", "\r\n", " /* operand */\n", "\n// operand\n"}
	for _, key := range keys {
		for i := range trivia {
			f.Add([]byte(key + ":" + strconv.Itoa(i)))
		}
	}
	f.Fuzz(func(t *testing.T, input []byte) {
		key, suffix, _ := strings.Cut(string(input), ":")
		index := 0
		if len(input) > 0 {
			index = int(input[0]) % len(keys)
		}
		for i, k := range keys {
			if key == k {
				index = i
				break
			}
		}
		gap, err := strconv.Atoi(suffix)
		if err != nil || gap < 0 {
			gap = len(input)
		}
		source := "effect function f() { const result = try" + trivia[gap%len(trivia)] + operands[index] + "; return result }"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		rule := fmt.Sprintf("%s:%d", keys[index], gap%len(trivia))
		if ds := file.Diagnostics(); len(ds) != 0 {
			Gap(t, tryOperandTarget, rule, "VIP-5 unary operand has parser diagnostics %v: %s", ds, source)
			return
		}
		tried := 0
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if node.Flags&ast.NodeFlagsVibeLangTry != 0 {
				tried++
			} else if ast.IsCallExpression(node) && ast.IsIdentifier(node.Expression()) && node.Expression().Text() == "$try" {
				tried++
			}
			return node.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		if tried != 1 {
			Gap(t, tryOperandTarget, rule, "VIP-5 TryExpression must retain exactly one execution operator; got %d: %s", tried, source)
		}
	})
}

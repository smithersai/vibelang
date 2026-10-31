package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const fiberUnaryQuote = "ForkOperand = UnaryExpression"
const fiberReservationQuote = "No next-token test applies."

func fiberUnaryChapter(tb testing.TB) {
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		tb.Fatal(err)
	}
	for _, quote := range []string{fiberUnaryQuote, fiberReservationQuote} {
		if !strings.Contains(string(text), quote) {
			tb.Fatalf("Appendix A no longer says %q", quote)
		}
	}
}
func TestFiberUnaryOperandsQuoted(t *testing.T) { fiberUnaryChapter(t) }

// These are the independent UnaryExpression alternatives in Appendix A's
// TypeScript grammar. Static grammar acceptance, rather than operand type or
// runtime behavior, is the oracle: most literals are not actual Effects.
func FuzzFiberUnaryOperands(f *testing.F) {
	startShortBudget(f)
	fiberUnaryChapter(f)
	keys := []string{"assertion", "plus", "minus", "not", "bit-not", "typeof", "void", "delete", "prefix-update", "postfix-update", "paren", "array", "object", "number", "bigint", "string", "boolean", "null", "template", "regexp", "this", "super", "new", "function", "class", "import", "effect-block", "do", "nested-fork", "nested-join", "jsx", "jsx-fragment", "identifier", "member", "element", "call", "optional-member", "optional-call", "tagged-template", "new-target", "import-meta", "async-function", "async-arrow", "generator", "async-generator", "try", "match", "non-null", "postfix-decrement", "prefix-decrement", "effect-arrow", "effect-assertion"}
	operands := []string{"<number>value", "+value", "-value", "!value", "~value", "typeof value", "void value", "delete obj.value", "++value", "value++", "(value)", "[value][0]", "{value: value}", "1", "1n", "\"text\"", "true", "null", "`text`", "/value/", "this.value", "super.value", "new Work()", "function () {}", "class {}", "import(\"mod\")", "effect { return value }", "do { value }", "fork value", "join value", "<b/>", "<><b/></>", "value", "obj.value", "obj[0]", "work()", "obj?.value", "work?.()", "tag`text`", "new.target", "import.meta", "async function () { return await value }", "(async () => await value)", "function* () { yield value }", "async function* () { yield await value }", "try value", "match (value) { when 1: 2; default: 3; }", "value!", "value--", "--value", "(effect () => value)", "<number!!>value"}
	for _, k := range keys {
		f.Add([]byte("fork:" + k))
		f.Add([]byte("join:" + k))
		f.Add([]byte("fork:" + k + ":x"))
		f.Add([]byte("join:" + k + ":x"))
	}
	f.Fuzz(func(t *testing.T, input []byte) {
		parts := strings.SplitN(string(input), ":", 3)
		operator := "fork"
		if len(parts) > 0 && parts[0] == "join" {
			operator = "join"
		}
		index := 0
		if len(input) != 0 {
			index = int(input[0]) % len(keys)
		}
		if len(parts) > 1 {
			for i, k := range keys {
				if parts[1] == k {
					index = i
					break
				}
			}
		}
		gap := " "
		if len(parts) > 2 {
			gap = []string{" ", "\n", " /* operand */ ", " /* operand\n */ "}[len(parts[2])%4]
		}
		// Every source Effect callable must apply the same reservation.
		wrappers := []string{"effect function f() { return %s }", "const f = effect () => %s", "const f = effect { return %s }", "class C { effect f() { return %s } }"}
		wrap := 0
		if len(parts) > 2 {
			wrap = len(parts[2]) % len(wrappers)
		}
		source := strings.Replace(wrappers[wrap], "%s", operator+gap+operands[index], 1)
		// Keep native early-error contexts valid while testing their operand head.
		if keys[index] == "super" {
			source = "class C extends B { effect f() { return " + operator + gap + operands[index] + " } }"
		}
		if keys[index] == "new-target" {
			source = "function outer() { " + source + " }"
		}
		if keys[index] == "import-meta" {
			source = "export {}; " + source
		}

		kind := core.ScriptKindTS
		if strings.HasPrefix(keys[index], "jsx") {
			kind = core.ScriptKindTSX
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, kind)
		key := operator + ":" + keys[index]
		if ds := file.Diagnostics(); len(ds) != 0 {
			Gap(t, "FuzzFiberUnaryOperands", key, "Appendix A %s: valid UnaryExpression operand has syntax diagnostics %v in %q", fiberUnaryQuote, ds, source)
			return
		}
		found := false
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if n.Kind == ast.KindCallExpression && n.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0 {
				name := n.Expression().Text()
				if name == operator || operator == "join" && name == "$join" {
					found = true
					if keys[index] == "object" && n.AsCallExpression().Arguments.Nodes[0].Kind != ast.KindObjectLiteralExpression {
						Gap(t, "FuzzFiberUnaryOperands", key, "Appendix A %s: object UnaryExpression was converted to %v in %q", fiberUnaryQuote, n.AsCallExpression().Arguments.Nodes[0].Kind, source)
					}
				}
			}
			n.ForEachChild(visit)
			return false
		}
		visit(file.AsNode())
		if !found {
			Gap(t, "FuzzFiberUnaryOperands", key, "Appendix A %s: operator became an ordinary identifier in %q", fiberUnaryQuote, source)
		}
		ExpectPending(t, "FuzzFiberUnaryOperands", key)
	})
}

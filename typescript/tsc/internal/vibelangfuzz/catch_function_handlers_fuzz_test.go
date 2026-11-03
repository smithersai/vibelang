package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const catchFunctionTarget = "FuzzCatchFunctionHandlers"
const catchFunctionQuote = "NonArrowHandler = FunctionExpression | EffectFunction   (no generator, async or async generator expression: VIP-5, amended)"

func catchFunctionChapter(t testing.TB) {
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), catchFunctionQuote) {
		t.Fatalf("Appendix A no longer says %q", catchFunctionQuote)
	}
}

func TestCatchFunctionHandlersQuoted(t *testing.T) { catchFunctionChapter(t) }

func FuzzCatchFunctionHandlers(f *testing.F) {
	startShortBudget(f)
	catchFunctionChapter(f)
	keys := []string{"plain", "named", "typed", "default", "effect", "effect-named"}
	heads := []string{"function ()", "function recover()", "function (e: unknown)", "function (e = 1)", "effect function ()", "effect function recover()"}
	for _, key := range keys {
		f.Add([]byte(key))
		f.Add([]byte(key + ":group"))
		f.Add([]byte(key + ":comment:group"))
	}
	f.Fuzz(func(t *testing.T, input []byte) {
		key, suffix, _ := strings.Cut(string(input), ":")
		index := 0
		if len(input) > 0 {
			index = int(input[0]) % len(keys)
		}
		for i, k := range keys {
			if k == key {
				index = i
				break
			}
		}
		handler := heads[index] + " { return 7 }"
		if strings.Contains(suffix, "comment") {
			handler = "/* handler */ " + handler
		}
		if strings.Contains(suffix, "group") {
			handler = "(" + handler + ")"
		}
		source := "const result = x catch " + handler
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if ds := file.Diagnostics(); len(ds) != 0 {
			Gap(t, catchFunctionTarget, keys[index], "VIP-5 function literal has parser diagnostics %v: %s", ds, source)
			return
		}
		statements := file.Statements.Nodes
		if len(statements) != 1 || statements[0].Kind != ast.KindVariableStatement {
			t.Fatalf("handler split the statement: %s", source)
		}
		call := statements[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Initializer()
		if call.Kind != ast.KindCallExpression {
			t.Fatalf("catch is not a call: %s", source)
		}
		fn := call.AsCallExpression().Arguments.Nodes[1]
		if fn.Kind != ast.KindFunctionExpression || (fn.Flags&ast.NodeFlagsVibeLangEffect != 0) != (index >= 4) {
			Gap(t, catchFunctionTarget, keys[index], "VIP-5 CatchHandler must keep its function literal kind and Effect modifier; got %v for %s", fn.Kind, source)
		}
	})
}

// Ordinary parameter annotations do not select or filter caught failures.
// The native Effect control checks the same failure and parameter types.
func TestTypedCatchHandlerParameters(t *testing.T) {
	catchFunctionChapter(t)
	w := NewWorkspace(t)
	for _, handler := range []string{
		"function (e: number) { return e + 4 }",
		"(e: number) => e + 4",
		"effect function (e: number) { return e + 4 }",
		"effect (e: number) => e + 4",
	} {
		source := "import { Effect } from \"effect\"; export effect function f() { return Effect.fail(3) catch " + handler + " }"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range result.Diagnostics {
			if d.Code() == 2112 {
				t.Errorf("ordinary handler annotation diagnosed as a legacy catch: %s", d.String())
			}
		}
		if HasError(result.Diagnostics) {
			t.Errorf("typed handler errors: %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
		}
		result.Remove()
	}
	source := "import { Effect } from \"effect\"; export function f() { return Effect.catch(Effect.fail(3), function (e: number) { return Effect.succeed(e + 4) }) }"
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": source}})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	if HasError(result.Diagnostics) {
		t.Fatalf("native typed-handler control: %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
	}
}

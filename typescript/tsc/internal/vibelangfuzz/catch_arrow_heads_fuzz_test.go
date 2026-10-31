package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const catchArrowHeadQuote = "ArrowHandler = ArrowFunction | EffectArrow"

func catchArrowHeadsChapter(tb testing.TB) {
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), catchArrowHeadQuote) {
		tb.Fatalf("Appendix A no longer says %q", catchArrowHeadQuote)
	}
}
func TestCatchArrowHeadsQuoted(t *testing.T) { catchArrowHeadsChapter(t) }

func FuzzCatchArrowHeads(f *testing.F) {
	startShortBudget(f)
	catchArrowHeadsChapter(f)
	keys := []string{"identifier", "contextual-async", "contextual-of", "contextual-type", "contextual-get", "empty", "typed", "destructured", "rest", "generic", "generic-comma", "constrained", "defaulted", "const", "multi"}
	heads := []string{"e", "async", "of", "type", "get", "()", "(e: unknown)", "({message}: {message: string})", "(...e: unknown[])", "<E>(e: E)", "<E,>(e: E)", "<E extends string>(e: E)", "<E = string>(e: E)", "<const E,>(e: E)", "<E, R = number>(e: E): R"}
	for _, k := range keys {
		f.Add([]byte(k))
		f.Add([]byte(k + ":effect"))
		f.Add([]byte(k + ":tsx"))
		f.Add([]byte(k + ":effect:tsx"))
	}
	f.Fuzz(func(t *testing.T, input []byte) {
		key, suffix, _ := strings.Cut(string(input), ":")
		index := 0
		if len(input) != 0 {
			index = int(input[0]) % len(keys)
		}
		for i, k := range keys {
			if key == k {
				index = i
				break
			}
		}
		effect := strings.Contains(suffix, "effect")
		prefix := ""
		if effect {
			prefix = "effect "
		}
		// Vary trivia and concise bodies without changing the ArrowFunction rule.
		gap := " "
		if len(suffix)%2 != 0 {
			gap = " /* head */ "
		}
		source := "const result = x catch " + prefix + heads[index] + gap + "=> 1"
		kind := core.ScriptKindTS
		ruleKey := keys[index]
		if strings.Contains(suffix, "tsx") {
			kind = core.ScriptKindTSX
			ruleKey += ":tsx"
			// ArrowHandler has the same head as a native ArrowFunction.
			// Compare these two contexts, as Appendix A requires, rather
			// than treating ambiguous single-parameter JSX as valid input.
			native := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.tsx", PathKey: "/main.tsx"}, "const handler = "+heads[index]+gap+"=> 1", kind)
			if len(native.Diagnostics()) != 0 {
				t.Skip("native TSX does not read this head as an ArrowFunction")
			}
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, kind)
		if ds := file.Diagnostics(); len(ds) != 0 {
			Gap(t, "FuzzCatchArrowHeads", ruleKey, "Appendix A %s: valid arrow handler %q has diagnostics %v", catchArrowHeadQuote, source, ds)
			return
		}
		ss := file.Statements.Nodes
		if len(ss) != 1 || ss[0].Kind != ast.KindVariableStatement {
			Gap(t, "FuzzCatchArrowHeads", ruleKey, "ArrowHandler was split into statements: %q", source)
			return
		}
		call := ss[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Initializer()
		if call.Kind != ast.KindCallExpression {
			Gap(t, "FuzzCatchArrowHeads", ruleKey, "catch did not produce a call: %q", source)
			return
		}
		args := call.AsCallExpression().Arguments.Nodes
		handler := args[1]
		if handler.Kind != ast.KindArrowFunction || (handler.Flags&ast.NodeFlagsVibeLangEffect != 0) != effect {
			Gap(t, "FuzzCatchArrowHeads", ruleKey, "Appendix A %s: handler has kind %s / Effect=%v for %q", catchArrowHeadQuote, fmt.Sprint(handler.Kind), handler.Flags&ast.NodeFlagsVibeLangEffect != 0, source)
		}
	})
}

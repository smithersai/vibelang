package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestDataGenericAssertionFix(t *testing.T) {
	for _, operator := range []string{"as", "satisfies"} {
		for i, gap := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029", " /* keep\n*/ ", " // keep\n"} {
			for j, tail := range []string{"", " as unknown", " as unknown || data", " as unknown ? data : data"} {
				t.Run(fmt.Sprintf("%s/%d/%d", operator, i, j), func(t *testing.T) {
					expression := "data " + operator + gap + "<T>(value:T)=>T" + tail
					source := "const data = <T>(value:T)=>value;\n/* before */ " + expression + "; // after\nexport const result:number = data(7)\n"
					file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
					var edits []sourceEdit
					for _, d := range file.Diagnostics() {
						if d.Source() == "EK" && d.Code() == EK1604.Code {
							span := core.NewTextRange(d.Pos(), d.End())
							edits = dataHeaderExpressionEdits(file, &span)
							if len(edits) != 0 {
								break
							}
						}
					}
					if len(edits) != 2 {
						t.Fatalf("no preserving repair: %v", file.Diagnostics())
					}
					want := "const data = <T>(value:T)=>value;\n/* before */ (" + expression + "); // after\nexport const result:number = data(7)\n"
					got := applyEdits(source, edits)
					if got != want {
						t.Fatalf("got %q, want %q", got, want)
					}
					after := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, got, core.ScriptKindTS)
					if len(after.Diagnostics()) != 0 {
						t.Fatalf("repaired source rejected: %v", after.Diagnostics())
					}
				})
			}
		}
	}
}

func TestDataGenericAssertionFixRefusals(t *testing.T) {
	for _, source := range []string{
		"data Name\n<T> { Ok { value:T } }",
		"data as\n<T> { Ok { value:T } }",
		"const value = (data as\n<T>()=>T)",
		"data as number",
		"data as\n<T>( => T",
		"schema as\n<T>()=>T",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		for i := range len(source) {
			if edits := dataGenericAssertionEdits(file, core.NewTextRange(i, i)); len(edits) != 0 {
				t.Fatalf("unrelated span repaired: %q at %d", source, i)
			}
		}
	}
}

func TestDataGenericAssertionProjectFix(t *testing.T) {
	source := "const data = <T>(value:T)=>value;\ndata as\n<T>(value:T)=>T;\ndata satisfies /* keep\n*/ <T>(value:T)=>T;\nexport const result:number = data(7)\n"
	result := fixProjectOf(t, map[string]string{"main.vibe": source})
	if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 1 {
		t.Fatalf("project repair failed: %+v", result)
	}
	var fixed string
	for _, file := range result.Files {
		fixed = file.Text
	}
	want := "const data = <T>(value:T)=>value;\n(data as\n<T>(value:T)=>T);\n(data satisfies /* keep\n*/ <T>(value:T)=>T);\nexport const result:number = data(7)\n"
	if fixed != want {
		t.Fatalf("got %q, want %q", fixed, want)
	}
	again := fixProjectOf(t, map[string]string{"main.vibe": fixed})
	if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("repair not idempotent: %+v", again)
	}
}

func TestDataGenericAssertionProjectRefusals(t *testing.T) {
	for _, source := range []string{
		"const broken = { value 1 }; export {}",
		"const broken: { value number } = { value: 1 }; export {}",
	} {
		result := fixProjectOf(t, map[string]string{"main.vibe": source})
		if len(result.Files) != 0 {
			t.Fatalf("unrelated TS1005 was repaired: %+v", result)
		}
	}
}

func TestDataGenericAssertionJSX(t *testing.T) {
	expression := "data as\n<T>(value:T)=>T"
	source := "const element = <span />;\nconst data = <T,>(value:T)=>value;\n" + expression + ";\nexport {}"
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibex", PathKey: "/main.vibex"}, source, core.ScriptKindTSX)
	for _, d := range file.Diagnostics() {
		if d.Source() != "EK" || d.Code() != EK1604.Code {
			continue
		}
		span := core.NewTextRange(d.Pos(), d.End())
		edits := dataHeaderExpressionEdits(file, &span)
		if len(edits) == 0 {
			continue
		}
		got := applyEdits(source, edits)
		if want := strings.Replace(source, expression, "("+expression+")", 1); got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
		after := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibex", PathKey: "/main.vibex"}, got, core.ScriptKindTSX)
		if len(after.Diagnostics()) != 0 {
			t.Fatal(after.Diagnostics())
		}
		return
	}
	t.Fatal("missing JSX-preserving assertion repair")
}

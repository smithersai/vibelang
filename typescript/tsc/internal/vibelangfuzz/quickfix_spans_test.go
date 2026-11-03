package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// The generator owns this span until the CLI publishes original-source
// refusal ranges. It deliberately excludes imports and other declarations.
func quickfixMarkedRefusal(text string) (toolsEdit, bool) {
	const open = "/* quickfix:refused:start */"
	const close = "/* quickfix:refused:end */"
	if start := strings.Index(text, open); start >= 0 {
		start += len(open)
		if end := strings.Index(text[start:], close); end >= 0 {
			return toolsEdit{start: start, end: start + end}, true
		}
	}
	start := strings.Index(text, "export const refused =")
	if start < 0 {
		return toolsEdit{}, false
	}
	end := strings.IndexByte(text[start:], '\n')
	if end < 0 {
		end = len(text) - start
	}
	return toolsEdit{start: start, end: start + end}, true
}

// Exact editor edits provide the stronger no-overlap check as well as the
// byte comparison. Insertions strictly within a protected span overlap it;
// insertions at either boundary may move it without changing its bytes.
func quickfixRefusedEdit(before, after string, span toolsEdit, edits []toolsEdit) string {
	shift := 0
	for _, edit := range edits {
		if edit.start < span.end && edit.end > span.start ||
			edit.start == edit.end && edit.start > span.start && edit.start < span.end {
			return fmt.Sprintf("edit [%d,%d) overlaps refused span [%d,%d)", edit.start, edit.end, span.start, span.end)
		}
		if edit.end <= span.start {
			shift += len(edit.text) - (edit.end - edit.start)
		}
	}
	start, end := span.start+shift, span.end+shift
	if start < 0 || end > len(after) || before[span.start:span.end] != after[start:end] {
		return "refused span's bytes changed"
	}
	return ""
}

func TestQuickFixRefusedSpan(t *testing.T) {
	const before = "prefix REFUSED suffix"
	span := toolsEdit{start: 7, end: 14}
	for _, test := range []struct {
		name string
		edit toolsEdit
		ok   bool
	}{
		{"move", toolsEdit{0, 6, "longer prefix"}, true},
		{"after", toolsEdit{15, 21, "tail"}, true},
		{"insert-before", toolsEdit{7, 7, "new "}, true},
		{"insert-after", toolsEdit{14, 14, " new"}, true},
		{"replace", toolsEdit{8, 9, "x"}, false},
		{"same-byte-overlap", toolsEdit{8, 9, "E"}, false},
		{"insert-within", toolsEdit{9, 9, "x"}, false},
		{"delete-across", toolsEdit{6, 15, ""}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			e := test.edit
			after := before[:e.start] + e.text + before[e.end:]
			problem := quickfixRefusedEdit(before, after, span, []toolsEdit{e})
			if (problem == "") != test.ok {
				t.Fatalf("problem=%q want unchanged=%t", problem, test.ok)
			}
		})
	}
}

// Enumerate every callable, zero-argument value export in emitted declarations,
// including ordinary, async and generator functions. Effect exports share this
// path; quickfixCaller selects their runtime observation without a second Exit
// comparator. Required arguments need generator-owned caller fixtures instead.
func quickfixOrdinaryExports(r *Result) []toolsRunnable {
	var entries []toolsRunnable
	for name, text := range r.Outputs {
		module, ok := strings.CutSuffix(name, ".d.ts")
		if !ok {
			continue
		}
		if _, ok := r.Outputs[module+".js"]; !ok {
			continue
		}
		file := toolsParse(name, text)
		add := func(fn *ast.Node, name string) {
			for _, parameter := range fn.Parameters() {
				p := parameter.AsParameterDeclaration()
				if p.QuestionToken == nil && p.DotDotDotToken == nil && p.Initializer == nil {
					return
				}
			}
			entries = append(entries, toolsRunnable{module + ".js", name})
		}
		for _, statement := range file.Statements.Nodes {
			if !ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) {
				continue
			}
			switch statement.Kind {
			case ast.KindFunctionDeclaration:
				if statement.Name() != nil {
					add(statement, statement.Name().Text())
				}
			case ast.KindVariableStatement:
				for _, d := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
					if d.Name().Kind == ast.KindIdentifier && d.Type() != nil {
						if d.Type().Kind == ast.KindFunctionType {
							add(d.Type(), d.Name().Text())
						} else if toolsEffectType.MatchString(strings.TrimSpace(text[d.Type().Pos():d.Type().End()])) {
							entries = append(entries, toolsRunnable{module + ".js", d.Name().Text()})
						}
					}
				}
			}
		}
	}
	return entries
}

func TestQuickFixRefusedSpanUTF16(t *testing.T) {
	const source = "😀REFUSED tail"
	// LSP columns count the astral character as two UTF-16 code units.
	span := lsproto.Range{Start: lsproto.Position{Line: 0, Character: 2}, End: lsproto.Position{Line: 0, Character: 9}}
	start, end, ok := newToolsLines(source).span(span)
	if !ok || start != 4 || end != 11 {
		t.Fatalf("UTF-16 refusal span mapped to [%d,%d), valid=%t", start, end, ok)
	}
	edit := toolsEdit{start: 0, end: 0, text: "prefix "}
	if problem := quickfixRefusedEdit(source, "prefix "+source, toolsEdit{start: start, end: end}, []toolsEdit{edit}); problem != "" {
		t.Fatal(problem)
	}
}

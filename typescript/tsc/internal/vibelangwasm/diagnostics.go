package vibelangwasm

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/locale"
)

func collectProgramDiagnostics(program *compiler.Program, file *ast.SourceFile, source string) []Diagnostic {
	if file == nil {
		return nil
	}
	ctx := context.Background()
	var raw []*ast.Diagnostic
	raw = append(raw, program.GetSyntacticDiagnostics(ctx, file)...)
	raw = append(raw, program.GetSemanticDiagnostics(ctx, file)...)
	return collectASTDiagnostics(raw, source)
}

func collectASTDiagnostics(raw []*ast.Diagnostic, source string) []Diagnostic {
	if len(raw) == 0 {
		return nil
	}
	starts := core.ComputeECMALineStarts(source)
	out := make([]Diagnostic, 0, len(raw))
	for _, d := range raw {
		if d == nil {
			continue
		}
		startPos, endPos := clampSpan(d.Pos(), d.End(), len(source))
		line, col := offsetToLineCol(starts, source, startPos)
		endLine, endCol := offsetToLineCol(starts, source, endPos)
		out = append(out, Diagnostic{
			Code:     formatDiagnosticCode(d.Source(), d.Code()),
			Severity: categoryToSeverity(d.Category()),
			Message:  flattenMessage(d),
			Line:     line,
			Col:      col,
			EndLine:  endLine,
			EndCol:   endCol,
		})
	}
	return out
}

func clampSpan(start int, end int, length int) (int, int) {
	if start < 0 {
		start = 0
	}
	if start > length {
		start = length
	}
	if end < start {
		end = start
	}
	if end > length {
		end = length
	}
	return start, end
}

func offsetToLineCol(starts []core.TextPos, text string, pos int) (int, int) {
	if len(starts) == 0 {
		return 1, 1
	}
	idx := sort.Search(len(starts), func(i int) bool { return int(starts[i]) > pos }) - 1
	if idx < 0 {
		idx = 0
	}
	lineStart := int(starts[idx])
	if lineStart > pos {
		lineStart = pos
	}
	col := int(core.UTF16Len(text[lineStart:pos])) + 1
	return idx + 1, col
}

func formatDiagnosticCode(source string, code int32) string {
	if source == "EK" {
		return fmt.Sprintf("EK%04d", code)
	}
	if source != "" {
		return source + strconv.Itoa(int(code))
	}
	return "TS" + strconv.Itoa(int(code))
}

func categoryToSeverity(cat diagnostics.Category) string {
	switch cat {
	case diagnostics.CategoryWarning:
		return "warning"
	case diagnostics.CategorySuggestion:
		return "suggestion"
	case diagnostics.CategoryMessage:
		return "message"
	default:
		return "error"
	}
}

func flattenMessage(d *ast.Diagnostic) string {
	base := d.Localize(locale.Default)
	if len(d.MessageChain()) == 0 {
		return base
	}
	var parts []string
	if base != "" {
		parts = append(parts, base)
	}
	for _, child := range d.MessageChain() {
		if text := flattenMessage(child); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n")
}

func dedupeAndSortDiagnostics(items []Diagnostic) []Diagnostic {
	if len(items) == 0 {
		return []Diagnostic{}
	}
	out := make([]Diagnostic, 0, len(items))
	seen := make(map[string]bool, len(items))
	for _, d := range items {
		key := diagnosticKey(d)
		if !seen[key] {
			seen[key] = true
			out = append(out, d)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Line != out[j].Line {
			return out[i].Line < out[j].Line
		}
		if out[i].Col != out[j].Col {
			return out[i].Col < out[j].Col
		}
		return out[i].Code < out[j].Code
	})
	return out
}

func diagnosticKey(d Diagnostic) string {
	return d.Code + ":" + strconv.Itoa(d.Line) + ":" + strconv.Itoa(d.Col) + ":" + d.Message
}

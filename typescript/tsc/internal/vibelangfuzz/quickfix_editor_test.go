package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

type quickfixEditorPlan struct {
	file  string
	start int
	edits map[string][]*lsproto.TextEdit
}

type quickfixRefusedSite struct {
	file string
	code int32
	span toolsEdit
}

// Capture both offered edits and per-site refusals from one untouched editor
// snapshot. Refusals are not a file-wide veto: edits at another site may move
// the protected bytes, but may not replace or overlap them.
func quickfixEditorPlans(t *testing.T, w *Workspace, original *Result, files map[string]string, codes []int32) ([]quickfixEditorPlan, []quickfixRefusedSite, map[int32]bool) {
	t.Helper()
	var plans []quickfixEditorPlan
	var refused []quickfixRefusedSite
	seen := map[int32]bool{}
	for name, text := range files {
		if !strings.HasSuffix(name, ".vibe") {
			continue
		}
		service, _ := toolsService(w, toolsProgram(w, original.Dir), toolsFileName(original.Dir, name))
		uri := toolsURI(original.Dir, name)
		diagnostics, err := toolsDiagnostics(t.Context(), service, uri)
		if err != nil {
			t.Fatal(err)
		}
		for _, diagnostic := range diagnostics {
			number, source := toolsDiagnosticCode(diagnostic)
			if source != "EK" || !slices.Contains(codes, number) {
				continue
			}
			seen[number] = true
			start, end, ok := newToolsLines(text).span(diagnostic.Range)
			if !ok {
				t.Fatalf("diagnostic outside %s: %v", name, diagnostic.Range)
			}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: diagnostic.Range,
				Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}},
			})
			if err != nil {
				t.Fatal(err)
			}
			offered := false
			if response.CommandOrCodeActionArray != nil {
				for _, candidate := range *response.CommandOrCodeActionArray {
					action := candidate.CodeAction
					if action == nil || action.Edit == nil || action.Kind == nil || *action.Kind != lsproto.CodeActionKindQuickFix {
						continue
					}
					changes, ok := toolsWorkspaceEdits(action.Edit)
					if !ok {
						t.Fatal("unreadable workspace edit")
					}
					plan := quickfixEditorPlan{file: name, start: start, edits: map[string][]*lsproto.TextEdit{}}
					for uri, edits := range changes {
						rel, err := filepath.Rel(original.Dir, uri.FileName().AsString())
						if err != nil {
							t.Fatal(err)
						}
						rel = filepath.ToSlash(rel)
						if !ValidProjectPath(rel) {
							Gap(t, quickfixBehaviorTarget, fmt.Sprintf("EK%04d:editor:scope", number), "edit outside the owned source tree: %s", rel)
						}
						plan.edits[rel] = edits
					}
					plans = append(plans, plan)
					offered = true
				}
			}
			if !offered {
				span := toolsEdit{start: start, end: end}
				if marked, ok := quickfixMarkedRefusal(text); ok && start >= marked.start && start < marked.end {
					span = marked
				}
				refused = append(refused, quickfixRefusedSite{file: name, code: number, span: span})
				t.Logf("refused-site editor %s:%d:%d-%d:%d EK%04d: provider offered no automatic repair", name,
					diagnostic.Range.Start.Line+1, diagnostic.Range.Start.Character+1, diagnostic.Range.End.Line+1, diagnostic.Range.End.Character+1, number)
			}
		}
	}
	return plans, refused, seen
}

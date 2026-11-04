package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const ambientErrorRepairQuote = "| a recognized `error` or `schema error` declaration in an ambient source context, explicit or inherited, as for a [service](005-services.md#static-rules): `declare error Missing`; it comes ahead of the declaration's other diagnostics | `EK1307` |"

func TestAmbientErrorRepairQuoted(t *testing.T) {
	chapterSays(t, "003-failures.md", ambientErrorRepairQuote)
	chapterSays(t, "007-tooling.md", "with a quick fix wherever the fix is mechanical.")
}

// Vary source ambient boundaries, payload presence, name collisions, trivia
// and UTF-16 offsets. The offered native-class action must actually typecheck.
func FuzzAmbientErrorRepair(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"schema-declare", "schema-export", "schema-namespace", "schema-nested", "schema-global", "data-declare"} {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestAmbientErrorRepairQuoted(t)
		form := "schema error"
		context := strings.TrimPrefix(key, "schema-")
		if strings.HasPrefix(key, "data-") {
			form, context = "error", strings.TrimPrefix(key, "data-")
		}
		templates := map[string]string{
			"declare":   "declare %s\nexport {}\n",
			"export":    "export declare %s\n",
			"namespace": "declare namespace API { export %s }\nexport {}\n",
			"nested":    "declare namespace API { namespace Nested { export %s } }\nexport {}\n",
			"global":    "declare global { %s }\nexport {}\n",
		}
		template, ok := templates[context]
		if !ok {
			context, template = "declare", templates["declare"]
		}
		body := ""
		if mode&1 != 0 {
			body = " { readonly id: string }"
		}
		source := fmt.Sprintf(template, form+" Missing"+body)
		if mode&4 != 0 {
			source = "declare const Schema: unknown\n" + source
		}
		if mode&2 != 0 {
			source = "// café 😀\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{"main.vibe": source}
		result := toolsCompile(t, w, "FuzzAmbientErrorRepair", files)
		defer result.Remove()
		editor := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: result, files: files, archive: Archive(files), main: "main.vibe", uri: toolsURI(result.Dir, "main.vibe")}
		var err error
		editor.run("didOpen", func() {
			editor.session.DidOpenFile(editor.ctx, editor.uri, 1, source, toolsLanguage)
			editor.service, err = editor.session.GetLanguageService(editor.ctx, editor.uri)
		})
		defer func() {
			if sessions.current == editor.session {
				editor.run("didClose", func() { editor.session.DidCloseFile(editor.ctx, editor.uri) })
			}
		}()
		if err != nil {
			t.Fatal(err)
		}
		items, ok := toolsRequest(editor, "ambient diagnostics", func(service *ls.LanguageService) ([]*lsproto.Diagnostic, error) {
			return toolsDiagnostics(t.Context(), service, editor.uri)
		})
		if !ok {
			t.Fatal("missing ambient diagnostics response")
		}
		var diagnostic *lsproto.Diagnostic
		for _, item := range items {
			if code, _ := toolsDiagnosticCode(item); code == 1307 {
				diagnostic = item
				break
			}
		}
		gapKey := "ambient-error-repair:" + key
		if diagnostic == nil {
			Gap(t, "FuzzAmbientErrorRepair", gapKey, "missing EK1307: %s", source)
			return
		}
		response, ok := toolsRequest(editor, "ambient native class", func(service *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: editor.uri}, Range: diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}}})
		})
		found := false
		if ok && response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				action := item.CodeAction
				if action == nil || action.Edit == nil || action.Title != "Write Missing as its Effect TypeScript class" {
					continue
				}
				found = true
				edited, _ := editor.apply(gapKey, action.Title, action.Edit)
				if edited == nil {
					Gap(t, "FuzzAmbientErrorRepair", gapKey, "invalid native class edit")
					continue
				}
				checked, err := w.Compile(t.Context(), Project{Files: edited})
				if err != nil {
					t.Fatal(err)
				}
				defer checked.Remove()
				if !toolsErrorFree(checked) {
					Gap(t, "FuzzAmbientErrorRepair", gapKey, "native ambient repair must typecheck: %v\n%s", checked.Diagnostics, edited["main.vibe"])
				}
				for _, d := range checked.Diagnostics {
					if d.Code() == 4830 || d.Code() == 4837 {
						Gap(t, "FuzzAmbientErrorRepair", gapKey, "native ambient class must not teach its rejected shorthand again: %v", d)
					}
				}
			}
		}
		if !found {
			Gap(t, "FuzzAmbientErrorRepair", gapKey, "missing mechanical native-class action: %s", source)
		}
	})
}

package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

const retiredAwaitAsyncTarget = "FuzzRetiredAwaitAsyncRecovery"
const retiredAwaitAsyncQuote = "The retired `await.all`, `await.race`, `await.any` and `await.allSettled` are `EK1802`."

func retiredAwaitAsyncChapter(t testing.TB) {
	if !strings.Contains(SpecText("900-appendices.md"), retiredAwaitAsyncQuote) {
		t.Fatal("stale retired-await grammar quote")
	}
}
func TestRetiredAwaitAsyncRecoveryQuoted(t *testing.T) { retiredAwaitAsyncChapter(t) }

func FuzzRetiredAwaitAsyncRecovery(f *testing.F) {
	startShortBudget(f)
	retiredAwaitAsyncChapter(f)
	ops := []string{"all", "race", "any", "allSettled"}
	contexts := []string{"async-function", "async-arrow", "async-method", "namespace", "effect", "native-ts", "native-module", "valid-native-await"}
	for _, op := range ops {
		for _, context := range contexts {
			f.Add([]byte(op + ":" + context))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		retiredAwaitAsyncChapter(t)
		oi, ci := 0, 0
		if len(data) > 0 {
			oi = int(data[0]) % 4
			ci = int(data[len(data)-1]) % len(contexts)
		}
		if p := strings.Split(string(data), ":"); len(p) == 2 {
			for i, v := range ops {
				if p[0] == v {
					oi = i
				}
			}
			for i, v := range contexts {
				if p[1] == v {
					ci = i
				}
			}
		}
		op, context := ops[oi], contexts[ci]
		key := op + ":" + context
		expr := "await." + op + " [E.succeed(1)]"
		name := "main.vibe"
		source := "export async function probe() {return " + expr + "}"
		switch context {
		case "async-arrow":
			source = "export const probe=async()=>" + expr
		case "async-method":
			source = "export class Probe {async run(){return " + expr + "}}"
		case "namespace":
			source = "export namespace N {export async function probe(){return " + expr + "}}"
		case "effect":
			source = "export effect function probe(){return " + expr + "}"
		case "native-ts":
			name = "main.ts"
		case "native-module":
			source = "module Legacy {export async function probe(){return " + expr + "}}"
		case "valid-native-await":
			source = "export async function probe(){const value={" + op + ":1};return await value." + op + "}"
		}
		source = "import {Effect as E} from 'effect'; " + source
		project := Project{Files: map[string]string{name: source}}
		result, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		nativeSyntaxError := false
		var warned *lsproto.Diagnostic
		file := result.SourceFile(name)
		service, converters := toolsService(w, result.Program, file.FileName())
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Source() != "EK" && diagnostic.Code() == 1109 && diagnostic.Category() == diagnostics.CategoryError {
				nativeSyntaxError = true
			}
			if diagnostic.Source() == "EK" && diagnostic.Code() == 1802 {
				count++
				warned = lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
				if diagnostic.Category() != diagnostics.CategoryError {
					Gap(t, retiredAwaitAsyncTarget, "category:"+key, "retired spelling is an error: %v", Keys(result.Dir, result.Diagnostics))
					return
				}
			}
			if context == "valid-native-await" && diagnostic.Category() == diagnostics.CategoryError {
				Gap(t, retiredAwaitAsyncTarget, "control:"+key, "native await control rejected: %v", Keys(result.Dir, result.Diagnostics))
				return
			}
		}
		if (context == "native-ts" || context == "native-module") && !nativeSyntaxError {
			Gap(t, retiredAwaitAsyncTarget, "native-ts:"+key, "ordinary TypeScript must retain TS1109: %v", Keys(result.Dir, result.Diagnostics))
			return
		}
		want := 1
		if context == "native-ts" || context == "native-module" || context == "valid-native-await" {
			want = 0
		}
		if count != want {
			Gap(t, retiredAwaitAsyncTarget, "diagnostic:"+key, "want%d EK1802, got%d\n%s\n%v", want, count, source, Keys(result.Dir, result.Diagnostics))
			return
		}
		if warned != nil && context != "effect" {
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			actions, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: warned.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{warned}, Only: &only}})
			if err != nil {
				t.Fatal(err)
			}
			if actions.CommandOrCodeActionArray != nil {
				for _, action := range *actions.CommandOrCodeActionArray {
					if action.CodeAction != nil && action.CodeAction.Edit != nil {
						Gap(t, retiredAwaitAsyncTarget, "context:"+key, "async source must not receive an effect-only syntax edit: %s\n%s", action.CodeAction.Title, fmt.Sprint(action.CodeAction.Edit))
						return
					}
				}
			}
		}
		ExpectPending(t, retiredAwaitAsyncTarget, key)
		ExpectPending(t, retiredAwaitAsyncTarget, specCorpusKey(t))
	})
}

package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestAsyncWrittenPromiseContractsQuoted(t *testing.T) { requireAsyncRefactorBridgeQuote(t) }

// A selected-function rewrite must keep containing written contracts valid.
// Every offered action is independently applied and checked; a context that
// accepts any result keeps both actions available.
func FuzzAsyncWrittenPromiseContracts(f *testing.F) {
	startShortBudget(f)
	requireAsyncRefactorBridgeQuote(f)
	keys := []string{"variable", "object", "implements", "extends", "static", "quoted", "computed", "callback", "assertion", "satisfies", "overload", "alias", "inferred-control", "own-annotation-control", "any-control", "unknown-control", "void-control", "object-control", "object-base-control"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		source, cursor, offer := asyncWrittenContractSource(key, mode)
		files := map[string]string{"main.vibe": source}
		result := toolsCompile(t, w, "FuzzAsyncWrittenPromiseContracts", files)
		defer result.Remove()
		if errors := toolsErrorCounts(result); len(errors) != 0 {
			Gap(t, "FuzzAsyncWrittenPromiseContracts", "async-contract:original:"+key, "original source has errors: %v\n%s", errors, Archive(files))
		}
		e := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: result, files: files, archive: Archive(files), main: "main.vibe", uri: toolsURI(result.Dir, "main.vibe")}
		var err error
		e.run("didOpen", func() {
			e.session.DidOpenFile(e.ctx, e.uri, 1, source, toolsLanguage)
			e.service, err = e.session.GetLanguageService(e.ctx, e.uri)
		})
		defer func() {
			if sessions.current == e.session {
				e.run("didClose", func() { e.session.DidCloseFile(e.ctx, e.uri) })
			}
		}()
		if err != nil {
			t.Fatal(err)
		}
		position := newToolsLines(source).position(cursor)
		response, ok := toolsRequest(e, "async written contract refactors", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return s.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri},
				Range:        lsproto.Range{Start: position, End: position},
				Context:      &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}},
			})
		})
		if !ok {
			t.Fatal("no refactor response")
		}
		count := 0
		if response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				action := item.CodeAction
				if action == nil || !strings.HasPrefix(action.Title, "Convert to a VibeLang function") {
					continue
				}
				count++
				edited, _ := e.apply("async-contract:"+key, action.Title, action.Edit)
				if edited == nil {
					Gap(t, "FuzzAsyncWrittenPromiseContracts", "async-contract:edit:"+key, "cannot apply offered action")
				}
				fixed := toolsCompile(t, w, "FuzzAsyncWrittenPromiseContracts", edited)
				added := toolsAddedErrors(result, fixed)
				fixed.Remove()
				if len(added) != 0 {
					Gap(t, "FuzzAsyncWrittenPromiseContracts", "async-contract:types:"+key, "%s; action %s adds errors: %v\n%s", asyncRefactorPreservationQuote, action.Title, added, Archive(edited))
				}
			}
		}
		if offer && count != 2 {
			Gap(t, "FuzzAsyncWrittenPromiseContracts", "async-contract:control:"+key, "expected both safe conversions, got %d\n%s", count, e.archive)
		}

	})
}

func asyncWrittenContractSource(key string, mode uint8) (string, int, bool) {
	name := fmt.Sprintf("load%d", mode)
	contract := "Promise<number>"
	if mode&4 != 0 {
		contract = "PromiseLike<number>"
	}
	params := "(input: Promise<number>)"
	arrow := "ASYNC " + params + " => await input"
	member := "ASYNC " + name + params + " { return await input }"
	signature := name + params + ": " + contract
	source := "export const " + name + ": (input: Promise<number>) => " + contract + " = " + arrow
	offer := false
	switch key {
	case "object":
		source = "export const holder: { " + signature + " } = { " + member + " }"
	case "implements":
		source = "interface Contract { " + signature + " }; export class Loader implements Contract { " + member + " }"
	case "extends":
		source = "class Base { " + name + params + ": " + contract + " { return input } }; export class Loader extends Base { " + member + " }"
	case "static":
		source = "class Base { static " + name + params + ": " + contract + " { return input } }; export class Loader extends Base { static " + member + " }"
	case "quoted", "computed":
		spelling := "\"" + name + "\""
		if key == "computed" {
			spelling = "[" + spelling + "]"
		}
		source = "export const holder: { " + signature + " } = { ASYNC " + spelling + params + " { return await input } }"
	case "callback":
		source = "function consume(f: (input: Promise<number>) => " + contract + ") {}; consume(" + arrow + ")"
	case "assertion":
		source = "export const " + name + " = (" + arrow + ") as ((input: Promise<number>) => " + contract + ")"
	case "satisfies":
		source = "export const " + name + " = (" + arrow + ") satisfies ((input: Promise<number>) => " + contract + ")"
	case "overload":
		source = "export function " + name + params + ": " + contract + "; export ASYNC function " + name + params + " { return await input }"
	case "alias":
		source = "type Work = (input: Promise<number>) => " + contract + "; export const " + name + ": Work = " + arrow
	case "inferred-control":
		source, offer = "export const "+name+" = "+arrow, true
	case "own-annotation-control":
		source, offer = "export ASYNC function "+name+params+": Promise<number> { return await input }", true
	case "any-control", "unknown-control", "void-control", "object-control":
		result := strings.TrimSuffix(key, "-control")
		source, offer = "export const "+name+": (input: Promise<number>) => "+result+" = "+arrow, true
	case "object-base-control":
		source, offer = "interface Contract { "+name+params+": object }; export class Loader implements Contract { "+member+" }", true
	}
	if mode&1 != 0 {
		source = "const café = \"😀\"; " + source
	}
	cursor := strings.Index(source, "ASYNC")
	source = strings.Replace(source, "ASYNC", "async /* keep */", 1)
	return source, cursor, offer
}

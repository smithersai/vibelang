package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestAsyncCallablePropertyContractsQuoted(t *testing.T) { requireAsyncRefactorBridgeQuote(t) }

// Callable properties keep inherited and applicable indexed contracts after
// conversion. Every original and every offered edit must check, while inferred
// fields and inapplicable index signatures retain both safe actions.
func FuzzAsyncCallablePropertyContracts(f *testing.F) {
	startShortBudget(f)
	requireAsyncRefactorBridgeQuote(f)
	keys := []string{"implements-field", "extends-field", "implements-expression", "static-field", "index-method", "class-index", "class-method-index", "number-index", "template-index", "symbol-index", "untyped-field-control", "object-base-field-control", "any-index-control", "unknown-class-index-control", "other-number-index-control", "other-template-index-control"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		source, cursor, offer := asyncCallablePropertySource(key, mode)
		files := map[string]string{"main.vibe": source}
		result := toolsCompile(t, w, "FuzzAsyncCallablePropertyContracts", files)
		defer result.Remove()
		if errors := toolsErrorCounts(result); len(errors) != 0 {
			Gap(t, "FuzzAsyncCallablePropertyContracts", "async-property:original:"+key, "original source has errors: %v\n%s", errors, Archive(files))
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
		response, ok := toolsRequest(e, "async callable property contract refactors", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
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
				edited, _ := e.apply("async-property:"+key, action.Title, action.Edit)
				if edited == nil {
					Gap(t, "FuzzAsyncCallablePropertyContracts", "async-property:edit:"+key, "cannot apply offered action")
				}
				fixed := toolsCompile(t, w, "FuzzAsyncCallablePropertyContracts", edited)
				added := toolsAddedErrors(result, fixed)
				fixed.Remove()
				if len(added) != 0 {
					Gap(t, "FuzzAsyncCallablePropertyContracts", "async-property:types:"+key, "%s; action %s adds errors: %v\n%s", asyncRefactorPreservationQuote, action.Title, added, Archive(edited))
				}
			}
		}
		if offer && count != 2 {
			Gap(t, "FuzzAsyncCallablePropertyContracts", "async-property:control:"+key, "expected both safe conversions, got %d\n%s", count, e.archive)
		}

	})
}

func asyncCallablePropertySource(key string, mode uint8) (string, int, bool) {
	source, offer := "", false
	switch key {
	case "implements-field":
		source, offer = "interface Contract { load(input: Promise<number>): Promise<number> }; export class Loader implements Contract { load = ASYNC (input: Promise<number>) => await input }", false
	case "extends-field":
		source, offer = "class Base { load = async (input: Promise<number>) => await input }; export class Loader extends Base { load = ASYNC (input: Promise<number>) => await input }", false
	case "implements-expression":
		source, offer = "interface Contract { load(input: Promise<number>): Promise<number> }; export class Loader implements Contract { load = ASYNC function (input: Promise<number>) { return await input } }", false
	case "static-field":
		source, offer = "class Base { static load = async (input: Promise<number>) => await input }; export class Loader extends Base { static load = ASYNC (input: Promise<number>) => await input }", false
	case "index-method":
		source, offer = "export const holder: Record<string, (input: Promise<number>) => Promise<number>> = { ASYNC load(input: Promise<number>) { return await input } }", false
	case "class-index":
		source, offer = "export class Loader { [key: string]: (input: Promise<number>) => Promise<number>; load = ASYNC (input: Promise<number>) => await input }", false
	case "class-method-index":
		source, offer = "export class Loader { [key: string]: (input: Promise<number>) => Promise<number>; ASYNC load(input: Promise<number>) { return await input } }", false
	case "number-index":
		source, offer = "export const holder: Record<number, (input: Promise<number>) => Promise<number>> = { ASYNC 7(input: Promise<number>) { return await input } }", false
	case "template-index":
		source, offer = "export const holder: { [key: `load${number}`]: (input: Promise<number>) => Promise<number> } = { ASYNC load7(input: Promise<number>) { return await input } }", false
	case "symbol-index":
		source, offer = "const key = Symbol(); export const holder: { [key: symbol]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }", false
	case "untyped-field-control":
		source, offer = "export class Loader { load = ASYNC (input: Promise<number>) => await input }", true
	case "object-base-field-control":
		source, offer = "interface Contract { load(input: Promise<number>): object }; export class Loader implements Contract { load = ASYNC (input: Promise<number>) => await input }", true
	case "any-index-control":
		source, offer = "export const holder: Record<string, (input: Promise<number>) => any> = { ASYNC load(input: Promise<number>) { return await input } }", true
	case "unknown-class-index-control":
		source, offer = "export class Loader { [key: string]: (input: Promise<number>) => unknown; load = ASYNC (input: Promise<number>) => await input }", true
	case "other-number-index-control":
		source, offer = "export class Loader { [key: number]: (input: Promise<number>) => Promise<number>; load = ASYNC (input: Promise<number>) => await input }", true
	case "other-template-index-control":
		source, offer = "export class Loader { [key: `task${number}`]: (input: Promise<number>) => Promise<number>; load = ASYNC (input: Promise<number>) => await input }", true
	default:
		source = "interface Contract { load(input: Promise<number>): Promise<number> }; export class Loader implements Contract { load = ASYNC (input: Promise<number>) => await input }"
	}
	if mode&4 != 0 {
		source = strings.ReplaceAll(source, "): Promise<number>", "): PromiseLike<number>")
		source = strings.ReplaceAll(source, "=> Promise<number>", "=> PromiseLike<number>")
	}
	if mode&1 != 0 {
		source = `const café = "😀"; ` + source
	}
	cursor := strings.Index(source, "ASYNC")
	source = strings.Replace(source, "ASYNC", fmt.Sprintf("async /* keep %d */", mode), 1)
	return source, cursor, offer
}

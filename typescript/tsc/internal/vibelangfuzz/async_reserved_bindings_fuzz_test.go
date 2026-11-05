package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const asyncReservedBindingQuote = "An `IdentifierReference`, `BindingIdentifier` or `LabelIdentifier` can't be `fork` or `join`"

func requireAsyncReservedBindingQuote(t testing.TB) {
	t.Helper()
	requireAsyncRefactorBridgeQuote(t)
	if !strings.Contains(SpecText("900-appendices.md"), asyncReservedBindingQuote) {
		t.Fatalf("missing Effect reservation rule: %q", asyncReservedBindingQuote)
	}
}
func TestAsyncReservedEffectBindingsQuoted(t *testing.T) { requireAsyncReservedBindingQuote(t) }

// Every offered async conversion must preserve valid bindings across Effect
// reservation boundaries. Ordinary callable bodies and property names remain
// controls; names, escapes, comments and Unicode offsets vary independently.
func FuzzAsyncReservedEffectBindings(f *testing.F) {
	startShortBudget(f)
	requireAsyncReservedBindingQuote(f)
	keys := []string{"expression-own-name", "arrow-parameter", "function-parameter", "local-binding", "destructuring-binding", "outer-reference", "label", "nested-declaration", "plain-arrow-head", "async-arrow-head", "computed-method", "computed-field", "heritage", "static-block", "shorthand", "default-binding", "declaration-name-control", "method-name-control", "nested-function-head-control", "nested-expression-name-control", "arrow-body-control", "field-initializer-control", "property-key-control", "nested-method-head-control"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		source, cursor, offer := asyncReservedBindingSource(key, mode)
		files := map[string]string{"main.vibe": source}
		result := toolsCompile(t, w, "FuzzAsyncReservedEffectBindings", files)
		defer result.Remove()
		if errors := toolsErrorCounts(result); len(errors) != 0 {
			Gap(t, "FuzzAsyncReservedEffectBindings", "async-reserved:original:"+key, "original source has errors: %v\n%s", errors, Archive(files))
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
		response, ok := toolsRequest(e, "async reserved binding refactors", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
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
				edited, _ := e.apply("async-reserved:"+key, action.Title, action.Edit)
				if edited == nil {
					Gap(t, "FuzzAsyncReservedEffectBindings", "async-reserved:edit:"+key, "cannot apply offered action")
				}
				fixed := toolsCompile(t, w, "FuzzAsyncReservedEffectBindings", edited)
				added := toolsAddedErrors(result, fixed)
				fixed.Remove()
				if len(added) != 0 {
					Gap(t, "FuzzAsyncReservedEffectBindings", "async-reserved:types:"+key, "%s; action %s adds errors: %v\n%s", asyncRefactorPreservationQuote, action.Title, added, Archive(edited))
				}
			}
		}
		if offer && count != 2 {
			Gap(t, "FuzzAsyncReservedEffectBindings", "async-reserved:control:"+key, "expected both safe conversions, got %d\n%s", count, e.archive)
		}

	})
}

func asyncReservedBindingSource(key string, mode uint8) (string, int, bool) {
	source, offer := "", false
	switch key {
	case "expression-own-name":
		source, offer = "export const load = ASYNC function WORD(input: Promise<number>) { return await input }", false
	case "arrow-parameter":
		source, offer = "export const load = ASYNC (WORD: Promise<number>) => await WORD", false
	case "function-parameter":
		source, offer = "export ASYNC function load(WORD: Promise<number>) { return await WORD }", false
	case "local-binding":
		source, offer = "export ASYNC function load(input: Promise<number>) { const WORD = await input; return WORD }", false
	case "destructuring-binding":
		source, offer = "export ASYNC function load({ WORD }: { WORD: Promise<number> }) { return await WORD }", false
	case "outer-reference":
		source, offer = "const WORD = (value: number) => value + 1; export ASYNC function load(input: Promise<number>) { return WORD(await input) }", false
	case "label":
		source, offer = "export ASYNC function load(input: Promise<number>) { WORD: { break WORD }; return await input }", false
	case "nested-declaration":
		source, offer = "export ASYNC function load(input: Promise<number>) { function WORD(value: number) { return value }; return WORD(await input) }", false
	case "plain-arrow-head":
		source, offer = "export ASYNC function load(input: Promise<number>) { const inner = (WORD: number) => WORD; return inner(await input) }", false
	case "async-arrow-head":
		source, offer = "export ASYNC function load(input: Promise<number>) { const inner = async (WORD: number) => WORD; return await inner(await input) }", false
	case "computed-method":
		source, offer = "const WORD = 'value'; export ASYNC function load(input: Promise<number>) { class Inner { [WORD]() { return 1 } }; return (await input) + new Inner().value() }", false
	case "computed-field":
		source, offer = "const WORD = 'value'; export ASYNC function load(input: Promise<number>) { class Inner { [WORD] = 1 }; return (await input) + new Inner().value }", false
	case "heritage":
		source, offer = "class WORD { value = 1 }; export ASYNC function load(input: Promise<number>) { class Inner extends WORD {}; return (await input) + new Inner().value }", false
	case "static-block":
		source, offer = "export ASYNC function load(input: Promise<number>) { class Inner { static { const WORD = 1; void WORD } }; return await input }", false
	case "shorthand":
		source, offer = "const WORD = 1; export ASYNC function load(input: Promise<number>) { const holder = { WORD }; return (await input) + holder.WORD }", false
	case "default-binding":
		source, offer = "export ASYNC function load(input: Promise<number>, WORD = 1) { return (await input) + WORD }", false
	case "declaration-name-control":
		source, offer = "export ASYNC function WORD(input: Promise<number>) { return await input }", true
	case "method-name-control":
		source, offer = "export const holder = { ASYNC WORD(input: Promise<number>) { return await input } }", true
	case "nested-function-head-control":
		source, offer = "export ASYNC function load(input: Promise<number>) { function inner(WORD: number) { return WORD }; return inner(await input) }", true
	case "nested-expression-name-control":
		source, offer = "export ASYNC function load(input: Promise<number>) { const inner = function WORD(value: number) { return value }; return inner(await input) }", true
	case "arrow-body-control":
		source, offer = "export ASYNC function load(input: Promise<number>) { const inner = () => { const WORD = 1; return WORD }; return (await input) + inner() }", true
	case "field-initializer-control":
		source, offer = "export ASYNC function load(input: Promise<number>) { class Inner { value = (() => { const WORD = 1; return WORD })() }; return (await input) + new Inner().value }", true
	case "property-key-control":
		source, offer = "export ASYNC function load(input: Promise<number>) { const holder = { WORD: 1 }; return (await input) + holder.WORD }", true
	case "nested-method-head-control":
		source, offer = "export ASYNC function load(input: Promise<number>) { const holder = { inner(WORD: number) { return WORD } }; return holder.inner(await input) }", true
	default:
		source = "export const load = ASYNC (WORD: Promise<number>) => await WORD"
	}
	word := "fork"
	if mode&1 != 0 {
		word = "join"
	}
	if mode&2 != 0 {
		if word == "fork" {
			word = `f\u006frk`
		} else {
			word = `j\u006fin`
		}
	}
	source = strings.ReplaceAll(source, "WORD", word)
	if mode&4 != 0 {
		source = `const café = "😀"; ` + source
	}
	cursor := strings.Index(source, "ASYNC")
	modifier := fmt.Sprintf("async /* keep %d */", mode)
	source = strings.Replace(source, "ASYNC", modifier, 1)
	return source, cursor, offer
}

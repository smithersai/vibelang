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
	keys = append(keys, "decl-factory-class", "decl-factory-field", "decl-factory-object", "decl-factory-arrow", "decl-factory-declaration", "decl-static-factory", "decl-getter-factory", "decl-generic-factory", "decl-symbol-inherited", "decl-collision", "decl-documented", "decl-directive", "decl-hashbang", "decl-multiple-await", "decl-private-control", "decl-annotated-control")
	keys = append(keys, "decl-nocheck-control", "decl-triple-reference", "decl-pinned-header", "decl-directive-tail", "decl-hoisted-factory")
	keys = append(keys, "decl-pragma-documentation")
	keys = append(keys, "decl-documentation-gap", "decl-documentation-crlf", "decl-pinned-documentation-gap", "decl-check-documentation-gap", "decl-documentation-pragma-gap", "decl-documentation-before-pragma", "decl-directive-documentation-gap", "decl-hashbang-documentation-gap")
	keys = append(keys, "computed-number-string", "computed-number-number", "computed-template", "computed-union", "computed-number-class", "computed-string-class", "computed-template-class", "computed-number-inherited", "computed-union-string", "computed-any-control", "computed-unknown-control", "computed-other-index-control", "computed-untyped-control")
	keys = append(keys, "computed-template-number-contract", "computed-template-other-contract", "named-other-inferred-contract", "literal-other-inferred-contract", "computed-string-union-number", "computed-template-untyped-control", "computed-literal-untyped-control")
	keys = append(keys, "computed-numeric-template-number", "computed-number-numeric-template", "computed-numeric-template-control")
	keys = append(keys, "generic-union-number", "generic-union-string", "generic-union-template", "generic-numeric-template", "generic-union-class", "generic-control", "generic-any-control", "generic-chained-number", "generic-keyof-number", "generic-conditional-number", "generic-union-inherited", "generic-number-contract", "generic-symbol-control", "generic-symbol-inherited-control", "generic-unknown-control", "generic-literal-number", "generic-chained-template", "generic-literal-disjoint-contract")
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
				// TypeScript keeps attached JSDoc across blank lines; an edit must
				// keep it with the same source declaration.
				if factoryStart := strings.Index(source, "export function create"); factoryStart >= 0 {
					if docStart := strings.LastIndex(source[:factoryStart], "/** Factory docs."); docStart >= 0 && !strings.Contains(edited["main.vibe"], source[docStart:factoryStart]+"export function create") {
						Gap(t, "FuzzAsyncCallablePropertyContracts", "async-property:documentation:"+key, "%s; action %s moves attached documentation%s", asyncRefactorPreservationQuote, action.Title, Archive(edited))
					}
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
	case "decl-factory-class":
		source, offer = "export function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-factory-field":
		source, offer = "export function create() { return class Loader { load = ASYNC (input: Promise<number>) => await input } }", true
	case "decl-factory-object":
		source, offer = "export function create() { return { load: ASYNC (input: Promise<number>) => await input } }", true
	case "decl-factory-arrow":
		source, offer = "export function create() { return ASYNC (input: Promise<number>) => await input }", true
	case "decl-factory-declaration":
		source, offer = "export function create() { ASYNC function load(input: Promise<number>) { return await input }; return load }", true
	case "decl-static-factory":
		source, offer = "export class Factory { static create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } } }", true
	case "decl-getter-factory":
		source, offer = "export class Factory { get loader() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } } }", true
	case "decl-generic-factory":
		source, offer = "export function create<K extends number | symbol>(key: K) { return class Loader { ASYNC [key](input: Promise<number>) { return await input } } }", true
	case "decl-symbol-inherited":
		source, offer = "class Base { [key: number]: (input: Promise<number>) => Promise<number> }; export function create<K extends symbol>(key: K) { return class Loader extends Base { ASYNC [key](input: Promise<number>) { return await input } } }", true
	case "decl-collision":
		source, offer = "const PromiseFailed = 0; export function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-documented":
		source, offer = "/** Factory docs. */\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-directive":
		source, offer = "\"use strict\";\n/** Factory docs. */\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-hashbang":
		source, offer = "#!vibelang\n\"use strict\";\n/** Factory docs. */\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-multiple-await":
		source, offer = "export function create() { return class Loader { ASYNC load(input: Promise<number>, other: Promise<number>) { const value = await input; return value + await other } } }", true
	case "decl-private-control":
		source, offer = "export {}; function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-annotated-control":
		source, offer = "export function create(): { new(): { load(input: Promise<number>): unknown } } { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-nocheck-control":
		source, offer = "// @ts-nocheck\nconst wrong: number = \"text\"; export function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-triple-reference":
		source, offer = "/// <reference lib=\"esnext.disposable\" />\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-pinned-header":
		source, offer = "/*! Factory license */\n/** Factory docs. */\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-directive-tail":
		source, offer = "\"use strict\"; // keep directive comment\n/** Factory docs. */\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-hoisted-factory":
		source, offer = "export const Loader = create();\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-pragma-documentation":
		source, offer = "/** Factory docs.\n * @jsx factory\n */\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", false
	case "decl-documentation-gap":
		source, offer = "/** Factory docs. */\n\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-documentation-crlf":
		source, offer = "/** Factory docs. */\r\n\r\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-pinned-documentation-gap":
		source, offer = "/*! Factory license */\n/** Factory docs. */\n\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-check-documentation-gap":
		source, offer = "// @ts-nocheck\n/** Factory docs. */\n\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-documentation-pragma-gap":
		source, offer = "/** Factory docs.\n * @jsx factory\n */\n\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", false
	case "decl-documentation-before-pragma":
		source, offer = "/** Factory docs. */\n\n// @ts-nocheck\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", false
	case "decl-directive-documentation-gap":
		source, offer = "\"use strict\";\n/** Factory docs. */\n\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
	case "decl-hashbang-documentation-gap":
		source, offer = "#!vibelang\n/** Factory docs. */\n\nexport function create() { return class Loader { ASYNC load(input: Promise<number>) { return await input } } }", true
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
	case "computed-number-string":
		source, offer = "const key: number = 7; export const holder: Record<string, (input: Promise<number>) => Promise<number>> = { ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-number-number":
		source, offer = "const key: number = 7; export const holder: Record<number, (input: Promise<number>) => Promise<number>> = { ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-template":
		source, offer = "const key = 'load7' as `load${number}`; export const holder: { [key: `load${number}`]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-union":
		source, offer = "const key = 7 as number | symbol; export const holder: Record<number, (input: Promise<number>) => Promise<number>> = { ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-number-class":
		source, offer = "const key: number = 7; export class Loader { [key: number]: (input: Promise<number>) => Promise<number>; ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-string-class":
		source, offer = "const key: number = 7; export class Loader { [key: string]: (input: Promise<number>) => Promise<number>; ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-template-class":
		source, offer = "const key = 'load7' as `load${number}`; export class Loader { [key: `load${number}`]: (input: Promise<number>) => Promise<number>; ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-number-inherited":
		source, offer = "const key: number = 7; class Base { [key: number]: (input: Promise<number>) => Promise<number> }; export class Loader extends Base { ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-union-string":
		source, offer = "const key = 7 as number | `load${number}`; export const holder: Record<string, (input: Promise<number>) => Promise<number>> = { ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-any-control":
		source, offer = "const key: number = 7; export const holder: Record<number, (input: Promise<number>) => any> = { ASYNC [key](input: Promise<number>) { return await input } }", true
	case "computed-unknown-control":
		source, offer = "const key = 'load7' as `load${number}`; export class Loader { [key: `load${number}`]: (input: Promise<number>) => unknown; ASYNC [key](input: Promise<number>) { return await input } }", true
	case "computed-other-index-control":
		source, offer = "const key: number = 7; export class Loader { [key: symbol]: (input: Promise<number>) => Promise<number>; ASYNC [key](input: Promise<number>) { return await input } }", true
	case "computed-untyped-control":
		source, offer = "const key: number = 7; export class Loader { ASYNC [key](input: Promise<number>) { return await input } }", true
	case "computed-template-number-contract":
		source, offer = "const key = 'load7' as `load${number}`; export class Loader { [key: number]: (input: Promise<number>) => Promise<number>; ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-template-other-contract":
		source, offer = "const key = 'load7' as `load${number}`; export class Loader { [key: `task${number}`]: (input: Promise<number>) => Promise<number>; ASYNC [key](input: Promise<number>) { return await input } }", false
	case "named-other-inferred-contract":
		source, offer = "const key: string = 'other'; export class Loader { async [key](input: Promise<number>) { return await input }; ASYNC load(input: Promise<number>) { return await input } }", true
	case "literal-other-inferred-contract":
		source, offer = "const key: string = 'other'; const picked = 'load'; export class Loader { async [key](input: Promise<number>) { return await input }; ASYNC [picked](input: Promise<number>) { return await input } }", true
	case "computed-string-union-number":
		source, offer = "const key = '7' as '7' | 'load'; export const holder: Record<number, (input: Promise<number>) => Promise<number>> = { ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-template-untyped-control":
		source, offer = "const key = 'load7' as `load${number}`; export class Loader { ASYNC [key](input: Promise<number>) { return await input } }", true
	case "computed-literal-untyped-control":
		source, offer = "const picked = 'load'; export class Loader { ASYNC [picked](input: Promise<number>) { return await input } }", true
	case "computed-numeric-template-number":
		source, offer = "const key = '7' as `${number}`; export class Loader { [key: number]: (input: Promise<number>) => Promise<number>; ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-number-numeric-template":
		source, offer = "const key: number = 7; export class Loader { [key: `${number}`]: (input: Promise<number>) => Promise<number>; ASYNC [key](input: Promise<number>) { return await input } }", false
	case "computed-numeric-template-control":
		source, offer = "const key = '7' as `${number}`; export class Loader { ASYNC [key](input: Promise<number>) { return await input } }", true
	case "generic-union-number":
		source, offer = "export function create<K extends number | symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-union-string":
		source, offer = "export function create<K extends number | symbol>(key: K) { const holder: { [key: string]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-union-template":
		source, offer = "export function create<K extends `load${number}` | symbol>(key: K) { const holder: { [key: `load${number}`]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-numeric-template":
		source, offer = "export function create<K extends `${number}` | symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-union-class":
		source, offer = "export function create<K extends number | symbol>(key: K) { return class Loader { [key: number]: (input: Promise<number>) => Promise<number>; ASYNC [key](input: Promise<number>) { return await input } } }", false
	case "generic-control":
		source, offer = "export {}; function create<K extends number | symbol>(key: K) { return class Loader { ASYNC [key](input: Promise<number>) { return await input } } }", true
	case "generic-any-control":
		source, offer = "export function create<K extends number | symbol>(key: K) { const holder: Record<number, (input: Promise<number>) => any> = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", true
	case "generic-chained-number":
		source, offer = "export function create<K extends number | symbol, P extends K>(key: P) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-keyof-number":
		source, offer = "export function create<K extends keyof { [key: number]: unknown; [key: symbol]: unknown }>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-conditional-number":
		source, offer = "export function create<K extends number | symbol>(key: K extends number ? K : symbol) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-union-inherited":
		source, offer = "interface Base { [key: number]: (input: Promise<number>) => Promise<number> }; interface Derived extends Base {}; export function create<K extends number | symbol>(key: K) { const holder: Derived = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-number-contract":
		source, offer = "export function create<K extends number>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-symbol-control":
		source, offer = "export function create<K extends symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", true
	case "generic-symbol-inherited-control":
		source, offer = "class Base { [key: number]: (input: Promise<number>) => Promise<number> }; export {}; function create<K extends symbol>(key: K) { return class Loader extends Base { ASYNC [key](input: Promise<number>) { return await input } } }", true
	case "generic-unknown-control":
		source, offer = "export function create<K extends number | symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => unknown } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", true
	case "generic-literal-number":
		source, offer = "export function create<K extends \"7\" | symbol>(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-chained-template":
		source, offer = "export function create<K extends `${number}` | symbol, P extends K>(key: P) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
	case "generic-literal-disjoint-contract":
		source, offer = "export function create<K extends \"load\">(key: K) { const holder: { [key: number]: (input: Promise<number>) => Promise<number> } = { ASYNC [key](input: Promise<number>) { return await input } }; return holder }", false
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
	// Some written class indexes must satisfy an inferred Promise index;
	// their original value contracts cannot widen to PromiseLike.
	if mode&4 != 0 && key != "computed-template-number-contract" && key != "computed-template-other-contract" && key != "computed-number-numeric-template" && key != "computed-numeric-template-number" && key != "generic-union-class" {
		source = strings.ReplaceAll(source, "): Promise<number>", "): PromiseLike<number>")
		source = strings.ReplaceAll(source, "=> Promise<number>", "=> PromiseLike<number>")
	}
	if mode&1 != 0 {
		prefix := `const café = "😀"; `
		start := 0
		for {
			header := source[start:]
			if !strings.HasPrefix(header, "#!") && !strings.HasPrefix(header, "///") && !strings.HasPrefix(header, "// @ts-") {
				break
			}
			end := strings.IndexByte(header, '\n')
			if end < 0 {
				break
			}
			start += end + 1
		}
		source = source[:start] + prefix + source[start:]
	}
	cursor := strings.Index(source, "ASYNC")
	source = strings.Replace(source, "ASYNC", fmt.Sprintf("async /* keep %d */", mode), 1)
	return source, cursor, offer
}

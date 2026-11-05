package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Generated failure declarations and their references must retain the source
// bindings under the preserving editor-action rule in chapter 007.
func TestAsyncRefactorErrorNamesQuoted(t *testing.T) { requireAsyncRefactorBridgeQuote(t) }

func FuzzAsyncRefactorErrorNames(f *testing.F) {
	startShortBudget(f)
	requireAsyncRefactorBridgeQuote(f)
	keys := []string{"error", "class", "type", "interface", "value", "parameter", "local", "local-class", "expression-name", "arrow", "object-method", "class-method", "suffix", "escaped", "callee", "multi-await", "global", "control"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		// These authored bindings must not merge with, or capture, a generated error.
		collisions := []string{"PromiseFailed"}
		prefix, params := "", "input: Promise<number>"
		body := "{ return await input }"
		head := "export ASYNC function load"
		switch key {
		case "error":
			prefix = "error PromiseFailed { previous: string }; "
		case "class":
			prefix = "class PromiseFailed {}; "
		case "type":
			prefix = "type PromiseFailed = number; "
		case "interface":
			prefix = "interface PromiseFailed { previous: string }; "
		case "value":
			prefix = "const PromiseFailed = 1; "
		case "parameter":
			params += ", PromiseFailed: number"
		case "local":
			body = "{ const PromiseFailed = 1; return await input }"
		case "local-class":
			body = "{ class PromiseFailed {}; return await input }"
		case "expression-name":
			head = "export const load = ASYNC function PromiseFailed"
		case "arrow":
			head = "export const load = ASYNC"
			params += ", PromiseFailed: number"
			body = "=> await input"
		case "object-method":
			head = "export const holder = { ASYNC load"
			params += ", PromiseFailed: number"
			body += " }"
		case "class-method":
			head = "export class Holder { ASYNC load"
			params += ", PromiseFailed: number"
			body += " }"
		case "suffix":
			prefix = "const PromiseFailed = 1; "
			for i := 2; i <= int(mode%4)+2; i++ {
				prefix += fmt.Sprintf("const PromiseFailed%d = %d; ", i, i)
				collisions = append(collisions, fmt.Sprintf("PromiseFailed%d", i))
			}
		case "escaped":
			prefix = "const Promise\\u0046ailed = 1; "
		case "callee":
			name := fmt.Sprintf("read%d", mode%8)
			collisions = []string{fmt.Sprintf("Read%dFailed", mode%8)}
			prefix = fmt.Sprintf("function %s(input: Promise<number>) { return input }; const Read%dFailed = 1; ", name, mode%8)
			body = "{ return await " + name + "(input) }"
		case "multi-await":
			collisions = []string{"PromiseFailed2"}
			prefix = "const PromiseFailed2 = 2; "
			body = "{ const a = await input; return a + await input }"
		case "global":
			prefix = "import type {} from \"./globals.js\"; const original: number = PromiseFailed; "
		case "control":
			collisions = nil
		default:
			key = "error"
			prefix = "error PromiseFailed { previous: string }; "
		}
		source := prefix + head + "(" + params + ") " + body
		if mode&2 != 0 {
			source = "// café 😀\n" + source
		}
		cursor := strings.Index(source, "ASYNC")
		source = strings.Replace(source, "ASYNC", "async /* keep */", 1)
		fileName := "main.vibe"
		if mode&1 != 0 {
			fileName = "main.vibex"
		}
		config := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": [\"" + fileName + "\"]\n}"
		files := map[string]string{fileName: source, "tsconfig.json": config}
		if key == "global" {
			files["globals.ts"] = "export {}; declare global { const PromiseFailed: number }"
		}
		r := toolsCompile(t, w, "FuzzAsyncRefactorErrorNames", files)
		defer r.Remove()
		e := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: r, files: files, archive: Archive(files), main: fileName, uri: toolsURI(r.Dir, fileName)}
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
		response, ok := toolsRequest(e, "async refactors", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return s.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri},
				Range:        lsproto.Range{Start: position, End: position},
				Context:      &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}},
			})
		})
		if !ok || response.CommandOrCodeActionArray == nil {
			t.Fatal("no async refactor response")
		}

		if !toolsErrorFree(r) {
			t.Fatalf("invalid original: %v\n%s", toolsErrorCounts(r), e.archive)
		}
		found := 0
		for _, item := range *response.CommandOrCodeActionArray {
			action := item.CodeAction
			if action == nil || !strings.HasPrefix(action.Title, "Convert to a VibeLang function") {
				continue
			}
			found++
			edited, _ := e.apply("async-error-name:"+key, action.Title, action.Edit)
			if edited == nil {
				t.Fatal("async refactor did not edit its document")
			}
			if strings.HasSuffix(action.Title, "with an error per await") {
				for _, name := range collisions {
					if strings.Contains(edited[fileName], "error "+name+" { cause: unknown }") {
						Gap(t, "FuzzAsyncRefactorErrorNames", "async-refactor:error-binding:"+key, "%s; generated error must not merge with or shadow authored binding %s\n%s", asyncRefactorPreservationQuote, name, Archive(edited))
					}
				}
			}
			after := toolsCompile(t, w, "FuzzAsyncRefactorErrorNames", edited)
			valid, errors := toolsErrorFree(after), toolsErrorCounts(after)
			after.Remove()
			if !valid {
				Gap(t, "FuzzAsyncRefactorErrorNames", "async-refactor:error-name:"+key, "%s; generated name captures or duplicates a source binding after %s: %v\n%s", asyncRefactorPreservationQuote, action.Title, errors, Archive(edited))
			}
		}
		if found != 2 {
			Gap(t, "FuzzAsyncRefactorErrorNames", "async-refactor:error-name-actions:"+key, "want both actions, got %d\n%s", found, e.archive)
		}
	})
}

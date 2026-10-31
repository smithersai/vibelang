package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const effectChannelParenthesesQuote = "`!` does not mix with `|`, `&`, conditional types, or a function or constructor type in a slot, without parentheses: each is a syntax error with a quick fix that parenthesizes (VIP-3, amended; `EK0301`)."

func TestEffectChannelParenthesesQuoted(t *testing.T) { requireEffectChannelParenthesesQuote(t) }
func requireEffectChannelParenthesesQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectChannelParenthesesQuote) {
		t.Fatalf("chapter 001 no longer contains %q", effectChannelParenthesesQuote)
	}
}

// VIP-3 requires preserving parentheses around compound Effect channels.
// Mutate the channel, operator, method contract, return and UTF-16 prefix.
func FuzzEffectChannelParentheses(f *testing.F) {
	startShortBudget(f)
	requireEffectChannelParenthesesQuote(f)
	for _, key := range []string{"success-union", "success-intersection", "error-union", "error-function", "error-conditional", "requirements-union", "conditional-part", "valid-function-return", "valid-parenthesized", "requirements-leading-union", "requirements-leading-intersection", "error-leading-union", "error-leading-intersection", "success-leading-union", "success-leading-intersection", "requirements-function", "requirements-constructor", "requirements-conditional", "conditional-false", "conditional-check", "conditional-extends", "valid-nested-generic", "valid-nested-object", "users-optional-success", "alchemy-stack-optional-trace", "file-tree-requirements-union"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(7))
		f.Add(key, uint8(32))
		f.Add(key, uint8(39))
	}
	f.Add("error-function", uint8(8))
	f.Add("success-union", uint8(16))
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		declarations := ""
		typ, fixed := "number | string!!", "(number | string)!!"
		switch key {
		case "users-optional-success":
			declarations = "interface User { id: string; name: string }\n"
			typ, fixed = "User | undefined!!", "(User | undefined)!!"
		case "alchemy-stack-optional-trace":
			declarations = "interface TraceJson { traceId: string; spanId: string; sampled: boolean }\n"
			typ, fixed = "TraceJson | undefined!!", "(TraceJson | undefined)!!"
		case "file-tree-requirements-union":
			declarations = "import type { FileSystem } from \"effect/FileSystem\"\nimport type { Path } from \"effect/Path\"\nimport type { PlatformError } from \"effect/PlatformError\"\n"
			typ, fixed = "void!PlatformError!FileSystem | Path", "void!PlatformError!(FileSystem | Path)"
		case "success-intersection":
			typ, fixed = "number & {}!!", "(number & {})!!"
		case "error-union":
			typ, fixed = "number!string | Error", "number!(string | Error)"
		case "error-function":
			typ, fixed = "number!() => string", "number!(() => string)"
			if mode&8 != 0 {
				typ, fixed = "number!new () => Error", "number!(new () => Error)"
			}
		case "error-conditional":
			typ, fixed = "number!string extends string ? Error : never", "number!(string extends string ? Error : never)"
		case "requirements-union":
			typ, fixed = "number!!string | symbol", "number!!(string | symbol)"
		case "conditional-part":
			typ, fixed = "string extends string ? number!Error : boolean", "string extends string ? (number!Error) : boolean"
		case "valid-function-return":
			typ, fixed = "() => number!Error", "() => number!Error"
		case "valid-parenthesized":
			typ, fixed = "(number | string)!!", "(number | string)!!"
		case "requirements-leading-union":
			typ, fixed = "number!! | null", "number!! (| null)"
		case "requirements-leading-intersection":
			typ, fixed = "number!! & { readonly x: 1 }", "number!! (& { readonly x: 1 })"
		case "error-leading-union":
			typ, fixed = "number! | Error", "number! (| Error)"
		case "error-leading-intersection":
			typ, fixed = "number! & { readonly x: 1 }", "number! (& { readonly x: 1 })"
		case "success-leading-union":
			typ, fixed = "| number!!", "(| number)!!"
		case "success-leading-intersection":
			typ, fixed = "& { readonly x: 1 }!!", "(& { readonly x: 1 })!!"
		case "requirements-function":
			typ, fixed = "number!!() => string", "number!!(() => string)"
		case "requirements-constructor":
			typ, fixed = "number!!new () => Error", "number!!(new () => Error)"
		case "requirements-conditional":
			typ, fixed = "number!!string extends string ? Error : never", "number!!(string extends string ? Error : never)"
		case "conditional-false":
			typ, fixed = "string extends string ? number : boolean!!", "string extends string ? number : (boolean!!)"
		case "conditional-check":
			typ, fixed = "number!! extends object ? true : false", "(number!!) extends object ? true : false"
		case "conditional-extends":
			typ, fixed = "string extends number!Error ? true : false", "string extends (number!Error) ? true : false"
		case "valid-nested-generic":
			typ, fixed = "number!Array<Error | string>", "number!Array<Error | string>"
		case "valid-nested-object":
			typ, fixed = "number!{ readonly item: string | number }", "number!{ readonly item: string | number }"
		default:
			key = "success-union"
		}
		prefix, suffix := "export type Program = ", "\n"
		form := "alias"
		switch mode % 3 {
		case 1:
			prefix, suffix = "export interface Program { load(): ", " }\n"
			form = "method"
		case 2:
			prefix = "export type Program = () => "
			form = "function-return"
		}
		if mode&4 != 0 {
			prefix = "const café = '😀';\n" + prefix
		}
		if mode&16 != 0 {
			prefix += "/* channel */"
		}
		source, want := declarations+prefix+typ+suffix, declarations+prefix+fixed+suffix
		key += ":" + form
		files := map[string]string{"main.vibe": source}
		config := ""
		if mode&32 != 0 {
			config = strings.Replace(DefaultConfig, "\"strict\": true,", "\"strict\": true, \"noCheck\": true,", 1)
			key += ":noCheck"
		}
		var result *Result
		var compileErr error
		toolsRun(t, "FuzzEffectChannelParentheses", "compile", Archive(files), nil, func() {
			result, compileErr = w.Compile(t.Context(), Project{Files: files, Config: config})
		})
		if compileErr != nil {
			t.Fatal(compileErr)
		}
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
		items, err := toolsDiagnostics(t.Context(), editor.service, editor.uri)
		if err != nil {
			t.Fatal(err)
		}
		var diagnostic *lsproto.Diagnostic
		for _, item := range items {
			if code, _ := toolsDiagnosticCode(item); code == 301 {
				diagnostic = item
				break
			}
		}
		if source == want {
			if diagnostic != nil {
				Gap(t, "FuzzEffectChannelParentheses", "effect-slot-parentheses:"+key, "valid type reports EK0301: %s", source)
			}
			return
		}
		if diagnostic == nil {
			Gap(t, "FuzzEffectChannelParentheses", "effect-slot-parentheses:"+key, "%s; missing EK0301: %s", effectChannelParenthesesQuote, source)
			return
		}
		response, ok := toolsRequest(editor, "parenthesize Effect channels", func(service *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: editor.uri}, Range: diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}}})
		})
		if !ok || response.CommandOrCodeActionArray == nil {
			Gap(t, "FuzzEffectChannelParentheses", "effect-slot-parentheses:"+key, "missing parenthesizing code actions")
			return
		}
		found := false
		for _, item := range *response.CommandOrCodeActionArray {
			action := item.CodeAction
			if action == nil || action.Edit == nil || action.Title != "Write parenthesized Effect type operands" {
				continue
			}
			edited, _ := editor.apply("effect-slot-parentheses:"+key, action.Title, action.Edit)

			found = true
			if got := edited["main.vibe"]; edited == nil || got != want {
				Gap(t, "FuzzEffectChannelParentheses", "effect-slot-parentheses:"+key, "%s; want:\n%s\ngot:\n%s", effectChannelParenthesesQuote, want, got)
			}
			if edited != nil {
				checked, err := w.Compile(t.Context(), Project{Files: edited, Config: config})
				if err != nil {
					t.Fatal(err)
				}
				defer checked.Remove()
				if !toolsErrorFree(checked) {
					Gap(t, "FuzzEffectChannelParentheses", "effect-slot-parentheses:"+key, "parenthesizing action did not typecheck: %v", checked.Diagnostics)
				}
			}
		}
		if !found {
			Gap(t, "FuzzEffectChannelParentheses", "effect-slot-parentheses:"+key, "no preserving EK0301 action\n%s", source)
		}
	})
}

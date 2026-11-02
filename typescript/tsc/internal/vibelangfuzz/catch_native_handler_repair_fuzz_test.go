package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func catchNativeHandlerRepairQuotes(t testing.TB) {
	t.Helper()
	b := string(rune(96))
	for _, rule := range []struct{ chapter, quote string }{
		{"002-running.md", "removes " + b + "async" + b + " or " + b + "*" + b + " from a function"},
		{"002-running.md", "a plain handler whose result type is a Promise or thenable"},
		{"002-running.md", "It is not a function: as TC39 specifies, " + b + "await" + b + " inside " + b + "do" + b + " belongs to the enclosing function"},
		{"007-tooling.md", "Quick fixes and codemods use the formatter to preserve the parse under Appendix A."},
		{"007-tooling.md", "preserves evaluation order, coldness, types, comments, and declaration output"},
	} {
		if !strings.Contains(SpecText(rule.chapter), rule.quote) {
			t.Fatalf("%s no longer says %q", rule.chapter, rule.quote)
		}
	}
}

func TestCatchNativeHandlerRepairQuoted(t *testing.T) { catchNativeHandlerRepairQuotes(t) }

// The oracle is static: removing a native function flag must leave an
// admitted plain handler, with no native suspension or Promise result stranded
// in it. Catch's runtime meaning remains in FuzzVIPDifferential.
func FuzzCatchNativeHandlerRepair(f *testing.F) {
	startShortBudget(f)
	catchNativeHandlerRepairQuotes(f)
	domains := []struct {
		key, handler string
		wantAction   bool
	}{
		{"async-await", "async (e:number)=>await Promise.resolve(e)", false},
		{"async-function-await", "async function(e:number){return await Promise.resolve(e)}", false},
		{"generator-yield", "function*(e:number){yield e;return 7}", false},
		{"generator-delegate", "function*(e:number){yield* [e];return 7}", false},
		{"async-generator", "async function*(e:number){yield await Promise.resolve(e)}", false},
		{"for-await", "async (e:number)=>{for await(const n of [e]){}return 7}", false},
		{"await-using", "async (e:number)=>{await using resource=null;return 7}", false},
		{"do-await", "async (e:number)=>do {await Promise.resolve(e)}", false},
		{"do-yield", "function*(e:number){return do {yield e;7}}", false},
		{"object-key-await", "async (e:number)=>({[await Promise.resolve('key')](){return e}})", false},
		{"class-key-await", "async (e:number)=>{class C{[await Promise.resolve('key')](){return e}}return 7}", false},
		{"class-heritage-await", "async (e:number)=>{class C extends(await Promise.resolve(Object)){}return 7}", false},
		{"object-key-yield", "function*(e:number){return {[yield 'key'](){return e}}}", false},
		{"async-contract", "async (e:number):Promise<number>=>7", false},
		{"generator-contract", "function*(e:number):Generator<number,number,unknown>{return 7}", false},
		{"promise-arrow", "async (e:number)=>Promise.resolve(e)", false},
		{"promise-block", "async (e:number)=>{return Promise.resolve(e)}", false},
		{"promise-union", "async (e:number)=>e?Promise.resolve(e):7", false},
		{"generator-promise", "function*(e:number){return Promise.resolve(e)}", false},
		{"thenable", "async (e:number)=>({then(resolve:(n:number)=>void){resolve(e)}})", false},
		{"async-value", "async (e:number)=>7", true},
		{"generator-return", "function*(e:number){return 7}", true},
		{"async-generator-return", "async function*(e:number){return 7}", true},
		{"nested-async", "async (e:number)=>{const f=async()=>await Promise.resolve(e);return 7}", true},
		{"nested-generator", "function*(e:number){const f=function*(){yield e};return 7}", true},
		{"nested-class", "async (e:number)=>{class C{async f(){return await Promise.resolve(e)}}return 7}", true},
		{"nested-method", "function*(e:number){return {*f(){yield e}}}", true},
		{"ignored-promise", "async (e:number)=>{const pending=Promise.resolve(e);return 7}", true},
		{"effect-data", "async (e:number)=>Effect.succeed(e)", true},
		{"keyword-data", "async (e:number)=>({await:e,yield:'yield',then:1})", true},
	}
	for _, d := range domains {
		f.Add([]byte(d.key))
		f.Add([]byte(d.key + "|comment"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := strings.TrimSuffix(string(data), "|comment")
		index := 0
		if len(data) > 0 {
			index = int(data[0]) % len(domains)
		}
		for i, d := range domains {
			if key == d.key {
				index = i
				break
			}
		}
		d := domains[index]
		handler := d.handler
		if strings.HasSuffix(string(data), "|comment") {
			if strings.Contains(handler, "=>") {
				handler = strings.Replace(handler, "=>", "=> /* keep */ ", 1)
			} else {
				handler = strings.Replace(handler, "{", "{ /* keep */ ", 1)
			}
		}
		key = d.key
		if handler != d.handler {
			key += "|comment"
		}
		source := "import {Effect} from 'effect';export effect function main(){return Effect.fail(1) catch " + handler + "}"
		config := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n\"files\":[\"main.vibe\"]\n}"
		config = strings.Replace(config, "\"target\": \"ES2022\",", "\"target\": \"ES2022\",\"lib\":[\"ESNext\"],", 1)
		project := func(text string) Project { return Project{Files: map[string]string{"main.vibe": text}, Config: config} }
		before, err := w.Compile(t.Context(), project(source))
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		var diagnostic *ast.Diagnostic
		for _, d := range before.Diagnostics {
			if d.Source() == "EK" && d.Code() == 509 {
				diagnostic = d
				break
			}
		}
		if diagnostic == nil {
			t.Fatalf("invalid native-handler fixture %s: %v\n%s", key, Keys(before.Dir, before.Diagnostics), source)
		}
		file := before.SourceFile("main.vibe")
		service, converters := toolsService(w, before.Program, file.FileName())
		item := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
		uri := lsconv.FileNameToDocumentURI(file.FileName())
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		actions, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: item.Range,
			Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{item}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		fixed := ""
		if actions.CommandOrCodeActionArray != nil {
			for _, item := range *actions.CommandOrCodeActionArray {
				if item.CodeAction == nil || !strings.HasPrefix(item.CodeAction.Title, "Write the handler as ") {
					continue
				}
				if item.CodeAction.Edit == nil {
					t.Fatal("keyword-removal action has no edit")
				}
				edits, ok := toolsWorkspaceEdits(item.CodeAction.Edit)
				if !ok || len(edits) != 1 {
					t.Fatal("keyword-removal action edits another file")
				}
				fixed, _, err = toolsApply(source, edits[uri])
				if err != nil {
					t.Fatal(err)
				}
			}
		}
		if (fixed != "") != d.wantAction {
			Gap(t, "FuzzCatchNativeHandlerRepair", "action:"+key, "native flag removal must leave an admitted plain handler: offered=%t want=%t before=%v\n%s", fixed != "", d.wantAction, Keys(before.Dir, before.Diagnostics), source)
			return
		}
		if !d.wantAction {
			return
		}
		if lost := toolsLostComments(source, fixed); len(lost) != 0 {
			Gap(t, "FuzzCatchNativeHandlerRepair", "comments:"+key, "repair lost body comments: %v", lost)
			return
		}
		after, err := w.Compile(t.Context(), project(fixed))
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		for _, d := range after.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzCatchNativeHandlerRepair", "compile:"+key, "keyword removal must leave valid source: %v\n%s", Keys(after.Dir, after.Diagnostics), fixed)
				return
			}
		}
	})
}

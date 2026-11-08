package vibelangfuzz

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const (
	legacyVarFixQuote      = "`let`, or `const` when the binding is never assigned"
	legacyVarPreserveQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."
)

func requireLegacyVarRewriteQuotes(t testing.TB) {
	t.Helper()
	for chapter, quote := range map[string]string{"001-functions.md": legacyVarFixQuote, "007-tooling.md": legacyVarPreserveQuote} {
		data, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

func TestLegacyVarRewriteQuoted(t *testing.T) { requireLegacyVarRewriteQuotes(t) }

// legacyVarShapes are var programs keyed by shape. offered marks the shapes
// whose block scoping cannot change what runs, which must get the rewrite.
var legacyVarShapes = []struct {
	key, source string
	offered     bool
}{
	{"top-const", "export function run(c: boolean) { var x = 1; return [c, x] }", true},
	{"top-let", "export function run(c: boolean) { var x = 1; if (c) x += 2; return x }", true},
	{"block", "export function run(c: boolean) { if (c) { var x = 2; return x } return 0 }", true},
	{"closure-after", "export function run(c: boolean) { var x = 3; const f = () => c ? x : -x; return f() }", false},
	{"module", "var x = 4\nexport const run = (c: boolean) => c ? x : 0", false},
	{"module-function", "var x = 4\nexport function run(c: boolean) { return c ? x : 0 }", false},
	{"destructuring", "export function run(c: boolean) { var { a, b = a } = { a: c ? 5 : 6 }; return [a, b] }", false},
	{"type-number", "export function run(c: boolean) { var x = 1; return [c, x] as const }", true},
	{"type-string", "export function run(c: boolean) { var x = \"hello\"; return [c, x] as const }", true},
	{"type-negative", "export function run(c: boolean) { var x = -2; return [c, x] as const }", true},
	{"type-conditional", "export function run(c: boolean) { var x = c ? 1 : 2; return [x] as const }", true},
	{"type-query", "export function run(c: boolean) { var x = 1; const y: typeof x = 2; return [c, y] }", true},
	{"type-generic", "function keep<const T>(x: T): T { return x }; export function run(c: boolean) { var x = 1; return keep([c, x] as const) }", true},
	{"type-written", "export function run(c: boolean) { var x: number = 1; return [c, x] as const }", true},

	{"capture-boolean", "export function run(c: boolean) { var x = true; return () => [c, x] as const }", false},
	{"capture-written-union", "export function run(c: boolean) { var x: string | undefined = c ? \"yes\" : undefined; if (x) return () => [x] as const; return () => [x] as const }", false},
	{"capture-method", "export function run(c: boolean) { var x = true; return { read() { return [c, x] as const } }.read }", false},

	{"hoisted-read", "export function run(c: boolean) { const early = h(); var x = 5; function h() { return typeof x } return [early, x, c] }", false},
	{"before-read", "export function run(c: boolean) { const y = typeof x; var x = 6; return [y, x, c] }", false},
	{"loop-closure", "export function run(c: boolean) { const fs: (() => number)[] = []; for (const i of [1, 2]) { var x = c ? i : -i; fs.push(() => x) } return fs.map(f => f()) }", false},
	{"outside-block", "export function run(c: boolean) { if (c) { var x = 7 } return x }", false},
	{"redeclare", "export function run(c: boolean) { var x = 1; if (c) { var x = 2 } return x }", false},
	{"self-init", "export function run(c: boolean) { var x: any = c ? typeof x : 0; return x }", false},
	{"case", "export function run(c: boolean) { switch (c ? 1 : 2) { case 1: var x = 8; return x; default: return typeof x } }", false},
}

// FuzzLegacyVarRewrite checks chapter 1's var quick fix against the original
// program's behavior: compiled as TypeScript, the var program and the
// rewritten .vibe program print the same result. Where block scoping could
// change it, the rewrite must refuse (chapter 7).
func FuzzLegacyVarRewrite(f *testing.F) {
	startShortBudget(f)
	requireLegacyVarRewriteQuotes(f)
	if _, err := exec.LookPath("node"); err != nil {
		f.Skip("node is not installed")
	}
	for _, shape := range legacyVarShapes {
		for mode := range uint8(4) {
			f.Add(shape.key, mode)
		}
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		shape := legacyVarShapes[int(mode)%len(legacyVarShapes)]
		for _, s := range legacyVarShapes {
			if s.key == key {
				shape = s
			}
		}
		source := shape.source
		if mode&2 != 0 {
			source = strings.Replace(source, "var ", "var /* legacy */ ", 1)
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzLegacyVarRewrite", files)
		defer r.Remove()
		e := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: r, files: files, archive: Archive(files), main: "main.vibe", uri: toolsURI(r.Dir, "main.vibe")}
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
		items, ok := toolsRequest(e, "var diagnostics", func(s *ls.LanguageService) ([]*lsproto.Diagnostic, error) {
			return toolsDiagnostics(t.Context(), s, e.uri)
		})
		if !ok {
			t.Fatal("no diagnostics response")
		}
		var diagnostic *lsproto.Diagnostic
		for _, d := range items {
			if d.Message.String != nil && strings.HasPrefix(*d.Message.String, "var is not allowed in a .vibe file") {
				diagnostic = d
				break
			}
		}
		if diagnostic == nil {
			Gap(t, "FuzzLegacyVarRewrite", "var-rewrite:diagnostic:"+shape.key, "no var diagnostic\n%s", source)
			return
		}
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, ok := toolsRequest(e, "var quick fix", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return s.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri},
				Range:        diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}, Only: &only},
			})
		})
		if !ok {
			t.Fatal("no quick-fix response")
		}
		rewritten := ""
		if response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				if a := item.CodeAction; a != nil && strings.HasSuffix(a.Title, " instead of var") {
					edits, ok := toolsWorkspaceEdits(a.Edit)
					if !ok {
						t.Fatal("missing rewrite edit")
					}
					if rewritten, _, err = toolsApply(source, edits[e.uri]); err != nil {
						t.Fatal(err)
					}
					break
				}
			}
		}
		if rewritten == "" {
			if shape.offered {
				Gap(t, "FuzzLegacyVarRewrite", "var-rewrite:offered:"+shape.key, "%s; no rewrite for a var whose block scoping keeps what runs\n%s", legacyVarFixQuote, source)
			}
			return
		}
		want := legacyVarRun(t, w, "main.ts", source, mode&1 != 0)
		got := legacyVarRun(t, w, "main.vibe", rewritten, mode&1 != 0)
		if got.value != want.value {
			Gap(t, "FuzzLegacyVarRewrite", "var-rewrite:behavior:"+shape.key, "%s\n%s\nprinted %q, the var program %q\n%s", legacyVarPreserveQuote, legacyVarFixQuote, got.value, want.value, rewritten)
		}
		if got.declaration != want.declaration {
			Gap(t, "FuzzLegacyVarRewrite", "var-rewrite:declaration:"+shape.key, "%s\nbefore:\n%s\nafter:\n%s\n%s", legacyVarPreserveQuote, want.declaration, got.declaration, rewritten)
		}
	})
}

type legacyVarObservation struct {
	value, declaration string
}

// legacyVarRun compiles source as name and prints run(c) as JSON, or the
// name of what it threw. A compile error prints its codes.
func legacyVarRun(t *testing.T, w *Workspace, name, source string, c bool) legacyVarObservation {
	t.Helper()
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{name: source}})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var codes []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, diagnosticCodeName(d.Source(), d.Code()))
		}
	}
	if len(codes) > 0 {
		return legacyVarObservation{value: "compile error " + strings.Join(codes, " ")}
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "main.js"), []byte(r.Outputs["out/main.js"]), 0o644); err != nil {
		t.Fatal(err)
	}
	arg := "false"
	if c {
		arg = "true"
	}
	runner := "import { run } from \"./main.js\"\nlet out\ntry { let value = run(" + arg + "); if (typeof value === \"function\") value = value(); out = JSON.stringify(value) ?? \"undefined\" } catch (e) { out = \"threw \" + e.constructor.name }\nprocess.stdout.write(out)\n"
	if err := os.WriteFile(filepath.Join(dir, "runner.mjs"), []byte(runner), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := exec.CommandContext(t.Context(), "node", filepath.Join(dir, "runner.mjs")).CombinedOutput()
	if err != nil {
		t.Fatalf("node: %v\n%s\n%s", err, out, r.Outputs["out/main.js"])
	}
	// These generated sources have no authored documentation. The one
	// allowed declaration difference is the generated no-throw contract.
	declaration := r.Outputs["out/main.d.ts"]
	if declaration == "" {
		t.Fatal("no emitted declaration")
	}
	declaration = regexp.MustCompile(`(?m)^[ \t]*/\*\* @throws \{never\} \*/\r?\n`).ReplaceAllString(declaration, "")
	return legacyVarObservation{value: string(out), declaration: declaration}
}

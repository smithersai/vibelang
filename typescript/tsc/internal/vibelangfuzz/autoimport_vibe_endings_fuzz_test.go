package vibelangfuzz

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const autoImportEndingsTarget = "FuzzAutoImportVibeEndings"

var autoImportEndingsSpecifier = regexp.MustCompile(`Add import from "([^"]+)"`)

// TestAutoImportVibeEndingsQuoted pins the two sentences the oracle reads: a
// written source suffix follows its TypeScript twin's checks, and resolution
// treats the VibeLang suffixes as the twin's native ones.
func TestAutoImportVibeEndingsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "Written `./x.vibe` and `./x.vibex` imports follow the `.ts`/`.tsx` twin's source-extension checks, including `TS5097` for a value import without `allowImportingTsExtensions` or `rewriteRelativeImportExtensions`.")
	chapterSays(t, "007-tooling.md", "Module resolution is as in TypeScript, with `.vibe` and `.vibex` beside `.ts` and `.tsx`")
}

// autoImportEndingsCase is one project: the imported module's language, the
// importing file's, the resolution mode, the source-extension option, where
// the module sits, and what the importing file reads from it.
type autoImportEndingsCase struct {
	dep, caller, resolution, option, layout, use string
}

func (c autoImportEndingsCase) key() string {
	return strings.Join([]string{c.dep, c.caller, c.resolution, c.option, c.layout, c.use}, "/")
}

func autoImportEndingsCaseOf(key string) (autoImportEndingsCase, bool) {
	parts := strings.Split(key, "/")
	if len(parts) != 6 {
		return autoImportEndingsCase{}, false
	}
	c := autoImportEndingsCase{parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]}
	valid := map[string][]string{
		c.dep:        {"vibe", "vibex"},
		c.caller:     {"ts", "vibe"},
		c.resolution: {"nodenext", "bundler"},
		c.option:     {"none", "allow", "rewrite"},
		c.layout:     {"sibling", "nested", "index"},
		c.use:        {"value", "call", "type"},
	}
	for value, allowed := range valid {
		found := false
		for _, candidate := range allowed {
			found = found || candidate == value
		}
		if !found {
			return autoImportEndingsCase{}, false
		}
	}
	return c, true
}

func autoImportEndingsCases() []autoImportEndingsCase {
	var cases []autoImportEndingsCase
	for _, dep := range []string{"vibe", "vibex"} {
		for _, caller := range []string{"ts", "vibe"} {
			for _, resolution := range []string{"nodenext", "bundler"} {
				for _, option := range []string{"none", "allow", "rewrite"} {
					for _, layout := range []string{"sibling", "nested", "index"} {
						for _, use := range []string{"value", "call", "type"} {
							cases = append(cases, autoImportEndingsCase{dep, caller, resolution, option, layout, use})
						}
					}
				}
			}
		}
	}
	return cases
}

// autoImportEndingsShort is the -short sample: every option in each resolution
// mode for both module languages, with the layouts and uses that decide a
// different ending.
func autoImportEndingsShort() []string {
	return []string{
		"vibe/ts/nodenext/none/sibling/value",
		"vibex/ts/nodenext/none/sibling/value",
		"vibe/ts/nodenext/rewrite/sibling/value",
		"vibex/ts/nodenext/rewrite/sibling/value",
		"vibe/ts/nodenext/allow/sibling/call",
		"vibe/vibe/nodenext/none/nested/value",
		"vibe/ts/bundler/none/sibling/value",
		"vibex/ts/bundler/none/sibling/value",
		"vibe/ts/bundler/none/index/type",
		"vibe/ts/bundler/allow/sibling/call",
		"vibe/ts/bundler/rewrite/nested/value",
		"vibe/vibe/bundler/none/index/value",
	}
}

func (c autoImportEndingsCase) config(names []string) string {
	module, resolution := "nodenext", "nodenext"
	if c.resolution == "bundler" {
		module, resolution = "esnext", "bundler"
	}
	options := map[string]any{
		"target": "esnext", "module": module, "moduleResolution": resolution,
		"strict": true, "verbatimModuleSyntax": true, "noEmitOnError": true,
		"jsx": "react-jsx", "types": []string{}, "outDir": "out",
	}
	switch c.option {
	case "allow":
		options["allowImportingTsExtensions"] = true
		options["noEmit"] = true
	case "rewrite":
		options["rewriteRelativeImportExtensions"] = true
	}
	text, _ := json.Marshal(map[string]any{"compilerOptions": options, "files": names})
	return string(text)
}

// project returns the importing file's name and the project. A twin project
// spells the imported module .ts or .tsx and changes nothing else.
func (c autoImportEndingsCase) project(twin bool) (string, string, map[string]string) {
	ext := map[string]string{"vibe": ".vibe", "vibex": ".vibex"}[c.dep]
	if twin {
		ext = map[string]string{"vibe": ".ts", "vibex": ".tsx"}[c.dep]
	}
	depName := map[string]string{"sibling": "dep", "nested": "lib/dep", "index": "lib/index"}[c.layout] + ext
	callerName := "main." + c.caller
	var exported, read string
	switch c.use {
	case "value":
		exported, read = "export const ImportedValue = 7;\n", "export const answer = ImportedValue;\n"
	case "call":
		exported, read = "export function ImportedValue(): number { return 7; }\n", "export const answer = ImportedValue();\n"
	default:
		exported, read = "export interface ImportedValue { readonly size: number }\n", "export function read(value: ImportedValue): number { return value.size; }\n"
	}
	files := map[string]string{"package.json": "{\"type\":\"module\"}\n", depName: exported, callerName: read}
	return callerName, c.config([]string{callerName, depName}), files
}

// autoImportEndingsRun applies the registered missing-name import and returns
// the specifier it wrote and the edited project.
func autoImportEndingsRun(t *testing.T, w *Workspace, sessions *toolsSessions, c autoImportEndingsCase, twin bool) (string, string, map[string]string) {
	t.Helper()
	name, config, files := c.project(twin)
	r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	e := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: r, files: files, archive: Archive(files), main: name, uri: toolsURI(r.Dir, name)}
	e.run("didOpen", func() {
		e.session.DidOpenFile(e.ctx, e.uri, 1, files[name], toolsDocumentLanguage(name))
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
	found, ok := toolsRequest(e, "auto-import diagnostics", func(s *ls.LanguageService) ([]*lsproto.Diagnostic, error) {
		return toolsDiagnostics(t.Context(), s, e.uri)
	})
	if !ok {
		t.Fatal("no diagnostics")
	}
	var missing *lsproto.Diagnostic
	for _, d := range found {
		if d.Code != nil && d.Code.Integer != nil && *d.Code.Integer == 2304 {
			missing = d
			break
		}
	}
	if missing == nil {
		t.Fatalf("%s: expected TS2304 before the fix, got %d diagnostics", c.key(), len(found))
	}
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, ok := toolsRequest(e, "auto-import action", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
		return s.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri},
			Range:        missing.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{missing}, Only: &only},
		})
	})
	if !ok || response.CommandOrCodeActionArray == nil {
		t.Fatalf("%s: no code actions", c.key())
	}
	for _, action := range *response.CommandOrCodeActionArray {
		if action.CodeAction == nil || action.CodeAction.Edit == nil {
			continue
		}
		match := autoImportEndingsSpecifier.FindStringSubmatch(action.CodeAction.Title)
		if match == nil {
			continue
		}
		edited, _ := e.apply(autoImportEndingsTarget, action.CodeAction.Title, action.CodeAction.Edit)
		if edited == nil {
			t.Fatalf("%s: action %q did not apply", c.key(), action.CodeAction.Title)
		}
		return match[1], config, edited
	}
	t.Fatalf("%s: no Add import action", c.key())
	return "", "", nil
}

func autoImportEndingsErrors(t *testing.T, w *Workspace, config string, files map[string]string) []string {
	t.Helper()
	r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var errors []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, specDiagnosticText(d))
		}
	}
	return errors
}

// autoImportEndingsWant maps the twin's spelling onto the VibeLang module. The
// twin's source suffix becomes the VibeLang one; every other ending is shared.
func autoImportEndingsWant(c autoImportEndingsCase, twin string) string {
	switch {
	case strings.HasSuffix(twin, ".tsx"):
		return strings.TrimSuffix(twin, ".tsx") + ".vibex"
	case strings.HasSuffix(twin, ".ts"):
		return strings.TrimSuffix(twin, ".ts") + ".vibe"
	}
	return twin
}

func FuzzAutoImportVibeEndings(f *testing.F) {
	startShortBudget(f)
	seeds := autoImportEndingsShort()
	if !testing.Short() || toolsFuzzing() || os.Getenv("VIBELANG_FUZZ_SEEDS") == "all" {
		seeds = nil
		for _, c := range autoImportEndingsCases() {
			seeds = append(seeds, c.key())
		}
	}
	for _, key := range seeds {
		f.Add(key)
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string) {
		c, ok := autoImportEndingsCaseOf(key)
		if !ok {
			return
		}
		toolsGuard(t, autoImportEndingsTarget, func() {
			twin, _, _ := autoImportEndingsRun(t, w, sessions, c, true)
			got, config, edited := autoImportEndingsRun(t, w, sessions, c, false)
			want := autoImportEndingsWant(c, twin)
			if got != want {
				Gap(t, autoImportEndingsTarget, "autoimport:ending:"+key, "the native import action wrote %q; the .ts twin wrote %q, so the VibeLang module takes %q\n%s", got, twin, want, Archive(edited))
			}
			if errors := autoImportEndingsErrors(t, w, config, edited); len(errors) != 0 {
				Gap(t, autoImportEndingsTarget, "autoimport:recheck:"+key, "the import action's own result does not compile: %v\n%s", errors, Archive(edited))
			}
		})
	})
}

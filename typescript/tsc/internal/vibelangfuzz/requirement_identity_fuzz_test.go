package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const requirementIdentityTarget = "FuzzRequirementIdentity"
const requirementIdentityQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestRequirementIdentityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), requirementIdentityQuote) {
		t.Fatalf("chapter 007 no longer says %q", requirementIdentityQuote)
	}
}

var requirementIdentityKeys = []string{"alias", "namespace", "collision", "two-services", "private", "generic", "local"}

// Mutate import style, exported/local names, same-name collisions, module
// specifiers, callable syntax and trivia. The oracle writes the source's bound
// service identity, not the compiler's context-free diagnostic display name.
func requirementIdentityProject(key string, data []byte) (map[string]string, string) {
	b := func(i int) byte {
		if i < len(data) {
			return data[i]
		}
		return 0
	}
	exported := []string{"Input", "Port", "Flags", "Café"}[int(b(0))%4]
	alias := []string{"Renamed", "Chosen", "Selected", "ServiceKey"}[int(b(1))%4]
	ext := []string{".js", ".vibe"}[int(b(2))%2]
	head := fmt.Sprintf("import {%s as %s} from \"./dep%s\";\n", exported, alias, ext)
	body, requirement := "(try "+alias+").value", alias
	// Stable written keys keep unrelated key-freezing passes out of this oracle.
	declaration := func(visibility, role string) string {
		return fmt.Sprintf("%sservice %s { static readonly key = %q; value: number }\n", visibility, exported, "requirements/"+role)
	}
	files := map[string]string{"dep.vibe": declaration("export ", "dep")}
	switch key {
	case "namespace":
		head = fmt.Sprintf("import * as %s from \"./dep%s\";\ntype %s = any;\n", alias, ext, exported)
		requirement = alias + "." + exported
		body = "(try " + requirement + ").value"
	case "collision":
		head += "type " + exported + " = " + []string{"any", "unknown", "object"}[int(b(3))%3] + ";\n"
	case "two-services":
		files["other.vibe"] = declaration("export ", "other")
		head += fmt.Sprintf("import {%s as Second} from \"./other%s\";\ntype %s = any;\n", exported, ext, exported)
		body += " + (try Second).value"
		requirement = "(" + alias + " | Second)"
	case "private":
		files["dep.vibe"] = declaration("", "dep") + "export const read = effect () => (try " + exported + ").value\n"
		head = fmt.Sprintf("import {read} from \"./dep%s\";\ntype %s = any;\n", ext, exported)
		body, requirement = "try read()", ""
	case "generic":
		head, body, requirement = "", "try p", "R"
	case "local":
		head, body, requirement = declaration("", "local"), "(try "+exported+").value", exported
	}
	params, generics := "", ""
	if key == "generic" {
		params, generics = "p: number!never!R", "<R>"
	}
	signature := "export effect function f" + generics + "(" + params + "): number!never"
	if b(4)%2 != 0 {
		signature = "export const f = effect " + generics + "(" + params + "): number!never =>"
	}
	source := head + signature + " { return " + body + " }\n"
	if b(5)%2 != 0 {
		source = "const café = \"😀\"; /* keep */\n" + source
	}
	// Keep both source and runtime specifier mutations valid while emitting.
	files["tsconfig.json"] = strings.Replace(DefaultConfig, `"sourceMap": true,`, `"sourceMap": true, "rewriteRelativeImportExtensions": true,`, 1)
	files["main.vibe"] = source
	want := ""
	if requirement != "" {
		want = strings.Replace(source, "): number!never", "): number!never!"+requirement, 1)
	}
	return files, want
}

func FuzzRequirementIdentity(f *testing.F) {
	startShortBudget(f)
	// Cover names, import extensions, callable kinds and UTF-16 trivia
	// deterministically, even when a short mutation campaign is slow.
	for _, key := range requirementIdentityKeys {
		for _, data := range [][]byte{
			{0, 0, 0, 0, 0, 0},
			{1, 1, 1, 1, 1, 1},
			{2, 2, 0, 2, 0, 1},
			{3, 3, 1, 0, 1, 0},
		} {
			f.Add(key, data)
		}
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		if !slices.Contains(requirementIdentityKeys, key) {
			if len(key) == 0 {
				key = "alias"
			} else {
				key = requirementIdentityKeys[int(key[0])%len(requirementIdentityKeys)]
			}
		}
		if len(data) > 32 {
			data = data[:32]
		}
		TestRequirementIdentityQuoted(t)
		files, want := requirementIdentityProject(key, data)
		toolsGuard(t, requirementIdentityTarget, func() {
			before := toolsCompile(t, w, requirementIdentityTarget, files)
			defer before.Remove()
			var missing, migration bool
			for _, d := range before.Diagnostics {
				if IsEK(d) && d.Code() == 9202 {
					missing = true
				}
				if IsEK(d) && d.Code() == 4853 {
					migration = true
				}
			}
			if !missing || migration != (want != "") {
				Gap(t, requirementIdentityTarget, "diagnostic:"+key, "%s: missing=%v migration=%v\n%s", requirementIdentityQuote, missing, migration, Archive(files))
				return
			}
			if want != "" {
				session := sessions.get(t)
				uri := toolsURI(before.Dir, "main.vibe")
				session.DidOpenFile(t.Context(), uri, 1, files["main.vibe"], toolsLanguage)
				defer session.DidCloseFile(t.Context(), uri)
				service, err := session.GetLanguageService(t.Context(), uri)
				if err != nil {
					t.Fatal(err)
				}
				ds, err := toolsDiagnostics(t.Context(), service, uri)
				if err != nil {
					t.Fatal(err)
				}
				found := false
				for _, d := range ds {
					code, source := toolsDiagnosticCode(d)
					if source != "EK" || code != 4853 {
						continue
					}
					only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
					response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
						TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: d.Range,
						Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
					})
					if err != nil {
						t.Fatal(err)
					}
					if response.CommandOrCodeActionArray == nil {
						continue
					}
					for _, action := range *response.CommandOrCodeActionArray {
						a := action.CodeAction
						if a == nil || !strings.HasPrefix(a.Title, "Write ") || a.Edit == nil {
							continue
						}
						e := &toolsEditor{t: t, ctx: t.Context(), w: w, r: before, files: files, archive: Archive(files), main: "main.vibe", uri: uri}
						fixed, _ := e.apply("requirement-identity:"+key, a.Title, a.Edit)
						if fixed == nil || fixed["main.vibe"] != want {
							Gap(t, requirementIdentityTarget, "editor:identity:"+key, "%s: expected bound requirements\nwant: %s\ngot: %v", requirementIdentityQuote, want, fixed)
							return
						}
						found = true
					}
				}
				if !found {
					Gap(t, requirementIdentityTarget, "editor:missing:"+key, "no EK4853 editor repair\n%s", Archive(files))
					return
				}
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
				fixed[rel] = file.Text
			}
			if want == "" {
				if fixed["main.vibe"] != files["main.vibe"] {
					Gap(t, requirementIdentityTarget, "cli:private:"+key, "rewrote inaccessible requirement: %s", Archive(fixed))
				}
				return
			}
			if fixed["main.vibe"] != want {
				Gap(t, requirementIdentityTarget, "cli:identity:"+key, "%s\nwant: %s\ngot: %s", requirementIdentityQuote, want, fixed["main.vibe"])
				return
			}
			after := toolsCompile(t, w, requirementIdentityTarget, fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, requirementIdentityTarget, "recheck:"+key, "repaired source fails: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), Archive(fixed))
			}
			again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
			if again.Err != nil || len(again.Files) != 0 {
				Gap(t, requirementIdentityTarget, "idempotence:"+key, "repair not stable: %v %v", again.Err, again.Files)
			}
		})
	})
}

package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// preludeBinding is one binding of an import from effect/http and a use of it.
type preludeBinding struct{ text, use string }

// preludeBindingPool holds two bindings the prelude makes redundant, one with
// a type modifier and each used only inside the module, one more that goes, and
// one renamed, which stays. Smithers apps/mvp, 2026-11-03:
// import { HttpClient, HttpClientRequest, type HttpClientResponse } lost its
// last two bindings and, with them, its closing brace.
var preludeBindingPool = []preludeBinding{
	{"HttpClient", "const client = (held: HttpClient.HttpClient) => held\n"},
	{"HttpClientRequest", "const get = (url: string) => HttpClientRequest.get(url)\n"},
	{"type HttpClientResponse", "const status = (response: HttpClientResponse.HttpClientResponse) => response.status\n"},
	{"HttpClient as Http", "export type Aliased = Http.HttpClient\n"},
}

// preludeBindingSource is a module that imports bindings, written with sep
// between them and trailing after the last, and uses each.
func preludeBindingSource(bindings []preludeBinding, sep, trailing string) string {
	var names []string
	var uses strings.Builder
	for _, b := range bindings {
		names = append(names, b.text)
		uses.WriteString(b.use)
	}
	open, close := "{ ", " }"
	if strings.Contains(sep, "\n") {
		open, close = "{\n  ", "\n}"
	}
	return "import " + open + strings.Join(names, sep) + trailing + close + " from \"effect/http\"\n\n" + uses.String()
}

// fixPreludeFiles runs vibelang --fix over sources, one .vibe module each by
// name, in one project, and returns each file's text after the run.
func fixPreludeFiles(t testing.TB, sources map[string]string) (map[string]string, []FixRefusal) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export {}\n")
	dir := filepath.Dir(file.FileName().AsString())
	var names []string
	for name, source := range sources {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(source), 0o600); err != nil {
			t.Fatal(err)
		}
		names = append(names, fmt.Sprintf("%q", name))
	}
	tsconfig := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":[` + strings.Join(names, ",") + `]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(tsconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	got := map[string]string{}
	for name, source := range sources {
		got[name] = source
	}
	for path, fixed := range result.Files {
		got[filepath.Base(path.AsString())] = fixed.Text
	}
	return got, result.Refused
}

var importBraceList = regexp.MustCompile(`(?s)^import \{(.*?)\} from "effect/http"`)

// keptBindings returns the bindings text's import from effect/http keeps,
// without whitespace, or nil when the file has no such import.
func keptBindings(text string) []string {
	match := importBraceList.FindStringSubmatch(text)
	if match == nil {
		return nil
	}
	var kept []string
	for _, part := range strings.Split(match[1], ",") {
		if part = strings.Join(strings.Fields(part), " "); part != "" {
			kept = append(kept, part)
		}
	}
	return kept
}

// vibelang --fix removes the prelude bindings of an import that keeps others
// whatever their order, type modifiers and layout: the bindings an import
// keeps are the ones each keeps alone (the compiler compared with itself on
// inputs that must agree), the import stays well formed, and nothing is
// refused. The import that loses every binding goes.
func TestFixPreludeRemovesBindingsInAnyOrder(t *testing.T) {
	sources := map[string]string{}
	for i, b := range preludeBindingPool {
		sources[fmt.Sprintf("alone%d.vibe", i)] = preludeBindingSource([]preludeBinding{b}, ", ", "")
	}
	type combo struct {
		order  []int
		layout int
	}
	layouts := []struct{ sep, trailing string }{{", ", ""}, {",\n  ", ""}, {",\n  ", ","}}
	var combos []combo
	var permute func(prefix []int, used int)
	permute = func(prefix []int, used int) {
		if len(prefix) >= 2 {
			combos = append(combos, combo{prefix, len(combos) % len(layouts)})
		}
		for i := range preludeBindingPool {
			if used&(1<<i) == 0 {
				permute(append(slices.Clone(prefix), i), used|1<<i)
			}
		}
	}
	permute(nil, 0)
	for n, c := range combos {
		var bindings []preludeBinding
		for _, i := range c.order {
			bindings = append(bindings, preludeBindingPool[i])
		}
		layout := layouts[c.layout]
		sources[fmt.Sprintf("combo%02d.vibe", n)] = preludeBindingSource(bindings, layout.sep, layout.trailing)
	}
	got, refused := fixPreludeFiles(t, sources)
	if len(refused) != 0 {
		t.Errorf("refused %+v", refused)
	}
	keeps := make([]bool, len(preludeBindingPool))
	for i, b := range preludeBindingPool {
		kept := keptBindings(got[fmt.Sprintf("alone%d.vibe", i)])
		keeps[i] = len(kept) == 1 && kept[0] == b.text
	}
	if keeps[0] || keeps[1] || keeps[2] || !keeps[3] {
		t.Fatalf("alone, the bindings kept are %v; want only the renamed binding kept", keeps)
	}
	for n, c := range combos {
		name := fmt.Sprintf("combo%02d.vibe", n)
		var want []string
		for _, i := range c.order {
			if keeps[i] {
				want = append(want, preludeBindingPool[i].text)
			}
		}
		text := got[name]
		kept := keptBindings(text)
		if strings.Join(kept, ",") != strings.Join(want, ",") || len(want) == 0 && strings.Contains(text, `from "effect/http"`) {
			t.Errorf("%s:\n%s\nbecame\n%s\nwant the import to keep %v", name, sources[name], text, want)
		}
	}
}

// The apps/mvp witness, written as it was: the rewrite that keeps what the
// declaration file writes, here HttpClient, removes the two bindings after it,
// with a type modifier first, in the middle or last, and every binding of an
// import the declaration file does not need.
func TestFixPreludeRemovesAdjacentBindings(t *testing.T) {
	kept := `import { HttpClient } from "effect/http"`
	uses := preludeBindingPool[0].use + preludeBindingPool[1].use + preludeBindingPool[2].use
	declared := map[string]bool{declaredImportKey("effect/http", "HttpClient"): true}
	cases := []struct {
		name, source string
		declared     map[string]bool
		want         string
	}{
		{"type modifier last", `import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"`, declared, kept},
		{"type modifier in the middle", `import { HttpClient, type HttpClientResponse, HttpClientRequest } from "effect/http"`, declared, kept},
		{"type modifier first", `import { type HttpClientResponse, HttpClientRequest, HttpClient } from "effect/http"`, declared, kept},
		{"every binding", `import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"`, nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source+"\n\n"+uses)
			program.GetSemanticDiagnostics(t.Context(), file)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			text := applyEdits(file.Text(), preludeRewritesOf(c, file, tc.declared, true).edits)
			first, _, _ := strings.Cut(text, "\n")
			if tc.want == "" && strings.Contains(text, "effect/http") || tc.want != "" && first != tc.want {
				t.Errorf("%s\nbecame\n%s\nwant the import\n%s", tc.source, text, tc.want)
			}
		})
	}
}

// FuzzFixPreludeBindingRemoval writes an import of the pool's bindings in an
// order and layout the bytes pick and checks what
// TestFixPreludeRemovesBindingsInAnyOrder checks.
func FuzzFixPreludeBindingRemoval(f *testing.F) {
	f.Add([]byte{0, 1, 2, 0})
	f.Add([]byte{3, 1, 2, 1})
	f.Add([]byte{2, 1, 3, 2})
	f.Fuzz(func(t *testing.T, data []byte) {
		var order []int
		used := 0
		layout := 0
		for _, b := range data {
			if i := int(b) % (len(preludeBindingPool) + 1); i < len(preludeBindingPool) && used&(1<<i) == 0 {
				order = append(order, i)
				used |= 1 << i
			} else if i == len(preludeBindingPool) {
				layout = int(b) / 8 % 3
			}
		}
		if len(order) < 2 {
			t.Skip()
		}
		seps := []struct{ sep, trailing string }{{", ", ""}, {",\n  ", ""}, {",\n    ", ","}}
		var bindings []preludeBinding
		var want []string
		for _, i := range order {
			bindings = append(bindings, preludeBindingPool[i])
			if i == 3 { // what TestFixPreludeRemovesBindingsInAnyOrder keeps
				want = append(want, preludeBindingPool[i].text)
			}
		}
		source := preludeBindingSource(bindings, seps[layout].sep, seps[layout].trailing)
		got, refused := fixPreludeFiles(t, map[string]string{"main.vibe": source})
		text := got["main.vibe"]
		if len(refused) != 0 || strings.Join(keptBindings(text), ",") != strings.Join(want, ",") || len(want) == 0 && strings.Contains(text, "effect/http") {
			t.Errorf("%s\nbecame\n%s\nwant the import to keep %v; refused %+v", source, text, want, refused)
		}
	})
}

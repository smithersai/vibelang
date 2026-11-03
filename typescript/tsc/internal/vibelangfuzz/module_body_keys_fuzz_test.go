package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Chapter 1 on module declarations (VIP-40). A keyed Effect service whose
// body moves into `module platform { }` keeps the key its .ts file gave it, a
// run-time service identity, so deterministicKeys must ask a body for the key
// it asks the sibling .ts file for. It asked for one built from the body's own
// file, a.vibe.platform.ts: `@x/pkg/a.vibe.platform/Port` where a.ts had
// `@x/pkg/a/Port` (platform-body:deterministicKeys-virtual-path, t3code
// desktop, 15 modules). This compares the compiler with itself on two inputs
// the quote says must agree.
const moduleBodyKeysQuote = "moving it to a sibling `.ts` file and replacing `from name` with that file's specifier changes no diagnostic, type, emitted statement, declaration or run-time observation"

func TestModuleBodyKeysQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), moduleBodyKeysQuote) {
		t.Fatalf("Chapter 1 no longer says %q", moduleBodyKeysQuote)
	}
}

// moduleBodyKeyCase is one keyed input, dir:file:module:kind:name:key:pattern;
// an unknown field takes its list's first entry (fuzz RULES.md rule 11).
type moduleBodyKeyCase struct {
	dir, file, module, kind, name, key, pattern string
}

var moduleBodyKeyFields = [][]string{
	{"src", "", "src/backend", "lib/nested"},
	{"a", "index", "Port", "DesktopNetworkInterfaces"},
	{"platform", "host", "Über"},
	{"service", "error", "nested", "two"},
	{"Port", "A", "file"},
	{"pkg-file-name", "pkg-dir-file", "pkg-dir-file-name", "body", "wrong"},
	{"default", "package-identifier", "default-hashed", "identifier"},
}

func parseModuleBodyKeyCase(input string) moduleBodyKeyCase {
	parts := strings.Split(input, ":")
	pick := func(i int) string {
		if i < len(parts) && slices.Contains(moduleBodyKeyFields[i], parts[i]) {
			return parts[i]
		}
		return moduleBodyKeyFields[i][0]
	}
	c := moduleBodyKeyCase{pick(0), pick(1), pick(2), pick(3), pick(4), pick(5), pick(6)}
	if c.name == "file" {
		c.name = c.file
		if c.file == "index" {
			c.name = "Index"
		}
	}
	return c
}

func (c moduleBodyKeyCase) String() string {
	return strings.Join([]string{c.dir, c.file, c.module, c.kind, c.name, c.key, c.pattern}, ":")
}

// keyText is the key the class is written with.
func (c moduleBodyKeyCase) keyText(name string) string {
	dir := strings.TrimPrefix(strings.TrimPrefix(c.dir, "src"), "/")
	join := func(parts ...string) string {
		return strings.Join(slices.DeleteFunc(parts, func(s string) bool { return s == "" }), "/")
	}
	switch c.key {
	case "pkg-dir-file":
		return join("@x/pkg", dir, c.file)
	case "pkg-dir-file-name":
		return join("@x/pkg", dir, c.file, name)
	case "body":
		return join("@x/pkg", dir, c.file+".vibe."+c.module, name)
	case "wrong":
		return "wrong/" + name
	}
	return join("@x/pkg", c.file, name)
}

// body is the TypeScript that the .ts twin holds and the module body holds.
func (c moduleBodyKeyCase) body() (text string, exports []string) {
	service := func(name string) string {
		return "export class " + name + " extends Context.Service<" + name + ", { readonly n: number }>()(" + jsonString(c.keyText(name)) + ") {}\n"
	}
	head := "import * as Context from \"effect/Context\"\nimport * as Data from \"effect/Data\"\n"
	switch c.kind {
	case "error":
		return head + "export class " + c.name + " extends Data.TaggedError(" + jsonString(c.keyText(c.name)) + ")<{ readonly n: number }> {}\n", []string{c.name}
	case "nested":
		return head + "export function make() {\n  class " + c.name + " extends Context.Service<" + c.name + ", { readonly n: number }>()(" + jsonString(c.keyText(c.name)) + ") {}\n  return " + c.name + "\n}\n", []string{"make"}
	case "two":
		return head + service(c.name) + service(c.name+"Two"), []string{c.name, c.name + "Two"}
	}
	return head + service(c.name), []string{c.name}
}

func jsonString(s string) string {
	data, _ := json.Marshal(s)
	return string(data)
}

func (c moduleBodyKeyCase) config(source string) string {
	patterns := []any{}
	for _, target := range []string{"service", "error"} {
		patterns = append(patterns, map[string]any{"target": target, "pattern": c.pattern, "skipLeadingPath": []string{"src/"}})
	}
	config := map[string]any{
		"compilerOptions": map[string]any{
			"strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler",
			"noEmit": true, "skipLibCheck": true, "types": []string{},
			"plugins": []any{map[string]any{
				"name":               "@effect/language-service",
				"diagnosticSeverity": map[string]string{"deterministicKeys": "error"},
				"keyPatterns":        patterns,
			}},
		},
		"files": []string{source},
	}
	data, _ := json.Marshal(config)
	return string(data)
}

// deterministicKeyReports returns the deterministicKeys messages of project.
func deterministicKeyReports(t *testing.T, w *Workspace, project Project) (reports []string, all []*ast.Diagnostic) {
	t.Helper()
	dir, err := w.writeProject(project)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	c := w.programIn(dir, true)
	all = c.Diagnostics
	if c.Program != nil {
		all = append(all, c.Program.GetSemanticDiagnostics(t.Context(), nil)...)
	}
	for _, d := range all {
		if text := d.MessageText(); strings.HasPrefix(text, "deterministicKeys:") {
			reports = append(reports, text)
		}
	}
	slices.Sort(reports)
	return reports, all
}

func checkModuleBodyKeys(t *testing.T, w *Workspace, c moduleBodyKeyCase) {
	t.Helper()
	text, exports := c.body()
	stem := path.Join(c.dir, c.file)
	pkg := `{"name":"@x/pkg","type":"module"}`
	twin := Project{Files: map[string]string{"package.json": pkg, stem + ".ts": text}, Config: c.config(stem + ".ts")}
	module := "module " + c.module + " {\n" + text + "}\nexport { " + strings.Join(exports, ", ") + " } from " + c.module + "\n"
	vibe := Project{Files: map[string]string{"package.json": pkg, stem + ".vibe": module}, Config: c.config(stem + ".vibe")}
	want, twinAll := deterministicKeyReports(t, w, twin)
	got, vibeAll := deterministicKeyReports(t, w, vibe)
	if c.key == "wrong" && len(want) == 0 && c.pattern != "identifier" {
		t.Fatalf("%s: the .ts twin reports no deterministicKeys for a wrong key; diagnostics %v", c, diagnosticTexts(twinAll))
	}
	if !slices.Equal(got, want) {
		t.Errorf("%s: the module body reports %q, its .ts twin %q\nbody:\n%s\nbody diagnostics %v", c, got, want, module, diagnosticTexts(vibeAll))
	}
}

func diagnosticTexts(ds []*ast.Diagnostic) []string {
	var texts []string
	for _, d := range ds {
		texts = append(texts, d.MessageText())
	}
	return texts
}

// The t3code shape (platform-body-key-minimal), and the keys its error kept.
func TestModuleBodyKeysT3codeDesktop(t *testing.T) {
	w := NewWorkspace(t)
	for _, input := range []string{
		"src:a:platform:service:Port:pkg-file-name:package-identifier",
		"src:a:platform:service:Port:body:package-identifier",
		"src/backend:DesktopNetworkInterfaces:platform:service:file:pkg-dir-file:default",
	} {
		checkModuleBodyKeys(t, w, parseModuleBodyKeyCase(input))
	}
}

// FuzzModuleBodyKeys moves keyed services and errors into module bodies over
// file names, directories, module names, key patterns and keys.
func FuzzModuleBodyKeys(f *testing.F) {
	startShortBudget(f)
	f.Add("src:a:platform:service:Port:pkg-file-name:package-identifier")
	f.Add("src/backend:index:host:two:A:wrong:default")
	f.Add("lib/nested:Port:Über:error:file:body:default-hashed")
	f.Add(":a:platform:nested:Port:pkg-dir-file-name:default")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string) {
		checkModuleBodyKeys(t, w, parseModuleBodyKeyCase(input))
	})
}

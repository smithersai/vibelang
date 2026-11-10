package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzLibOriginThrows checks that a web global's thrown type follows the
// declaration TypeScript selects for the call. A project's lib and types
// decide where btoa and atob come from: lib.dom.d.ts, whose intrinsic
// annotation is DOMException, or an npm package such as @types/node or
// @cloudflare/workers-types, whose untagged signature throws unknown.
// encodeURIComponent comes from lib.es5.d.ts in every project, so its
// verdict never depends on the lib. Each cell compiles one .vibe program
// under one project and expects the diagnostic Chapter 3 gives for the
// call's host: EK0401 in plain code for a call known to throw, EK0401 in a
// plain function whose return type is wholly effectful for any thrown type
// other than never, EK0403 in effect code for the same, nothing in the try
// block of a try statement. A .ts twin in the same project tells which
// declaration TypeScript selected; that is TypeScript's choice, not
// VibeLang's. A cell's key names the project, the callee, the call's form
// and its host. A gap's key names the contract (a lib row such as
// btoa@lib.dom.d.ts, or an untagged package such as @types/node), whether
// the callee is called or passed, and the host: @types/node/call/effect.

const libOriginTarget = "FuzzLibOriginThrows"

var libOriginQuotes = []struct{ chapter, text string }{
	{"003-failures.md", "A callable declared outside VibeLang, in a `.ts`, `.js` or `.d.ts` file, an npm package or a `module` body (VIP-40), carries a thrown type by one rule"},
	{"003-failures.md", "| no tag | `unknown` |"},
	{"003-failures.md", "The compiler supplies intrinsic annotations for TypeScript's lib globals and the explicit wrapper thunks"},
	{"003-failures.md", "An npm signature uses a library row below only when it carries that annotation; the inventory grants no implicit package contract."},
	{"003-failures.md", "tracked with its class when reachable from any input admitted by the selected signature's receiver and parameter types under TypeScript `strict`."},
	{"003-failures.md", "Its callee has a written `@throws {T}` other than `@throws {never}` (`@throws {unknown}` included), or has a `@rethrows` parameter given a callback known to throw."},
	{"003-failures.md", "and a parameter named by `@rethrows` admits anything"},
	{"003-failures.md", "A call whose throwing is unknown, such as an unannotated `.ts` function, stays an ordinary call"},
	{"003-failures.md", "unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function"},
	{"003-failures.md", "A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`"},
	{"003-failures.md", "In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))`"},
	{"003-failures.md", "plain `catch` handlers (parameters and body), and the module top level"},
	{"900-appendices.md", "`Array.prototype.map`, `.forEach`, `.filter`, `.find`, `.some`, `.every`, `.sort` | `@throws {never} @rethrows callbackfn`"},
	{"003-failures.md", "The normative [`throws.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/throws.json) supplies the remaining intrinsic global contracts"},
}

// libOriginProject is one tsconfig's choice of lib and types.
type libOriginProject struct {
	name  string
	lib   []string
	types []string
}

var libOriginProjects = []libOriginProject{
	{name: "dom", lib: []string{"ES2022", "DOM"}, types: []string{}},
	{name: "node", lib: []string{"ES2022"}, types: []string{"node"}},
	{name: "dom+node", lib: []string{"ES2022", "DOM", "DOM.Iterable"}, types: []string{"node"}},
	{name: "workers", lib: []string{"ES2022"}, types: []string{"@cloudflare/workers-types"}},
	{name: "dom+workers", lib: []string{"ES2022", "DOM", "DOM.Iterable"}, types: []string{"@cloudflare/workers-types"}},
}

var libOriginCallees = []string{"btoa", "atob", "encodeURIComponent"}

// The call's form: called directly, in a conditional's branch as the
// migrated OAuth client writes it, or passed to Array.prototype.map, whose
// rethrows contract carries the callee's thrown type to the map call.
var libOriginForms = []string{"call", "conditional", "map"}

var libOriginHosts = []string{"plain", "try", "effectful", "effect", "top"}

// The stubs copy the two packages' declarations of the globals: @types/node
// declares them in a declare global block of a module (web-globals/blob.d.ts),
// workers-types in a script, under a comment that is not JSDoc.
const libOriginNodeTypes = `import { Blob as _Blob } from "buffer";
declare global {
    function atob(data: string): string;
    function btoa(data: string): string;
}
`

const libOriginWorkersTypes = `/* [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/btoa) */
declare function btoa(data: string): string;
/* [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/atob) */
declare function atob(data: string): string;
`

const libOriginBuffer = `declare module "buffer" { export class Blob {} }
`

type libOriginCase struct {
	key     string
	project libOriginProject
	callee  string
	form    string
	host    string
}

func libOriginCases() []libOriginCase {
	var cases []libOriginCase
	for _, p := range libOriginProjects {
		for _, callee := range libOriginCallees {
			for _, form := range libOriginForms {
				for _, host := range libOriginHosts {
					cases = append(cases, libOriginCase{key: p.name + "/" + callee + "/" + form + "/" + host, project: p, callee: callee, form: form, host: host})
				}
			}
		}
	}
	return cases
}

func (c libOriginCase) expression(arg string) string {
	switch c.form {
	case "conditional":
		return arg + `.length === 0 ? "" : ` + c.callee + "(" + arg + ")"
	case "map":
		return "[" + arg + ", " + arg + "].map(" + c.callee + `).join(":")`
	}
	return c.callee + "(" + arg + ")"
}

func (c libOriginCase) source() string {
	switch c.host {
	case "try":
		return "export function probe(s: string): string {\n  try {\n    return " + c.expression("s") + "\n  } catch {\n    return \"\"\n  }\n}\n"
	case "effectful":
		return "import * as Effect from \"effect/Effect\"\nexport function probe(s: string): Effect.Effect<string> {\n  const v = " + c.expression("s") + "\n  return Effect.succeed(v)\n}\n"
	case "effect":
		return "export effect function probe(s: string) {\n  const v = " + c.expression("s") + "\n  return v\n}\n"
	case "top":
		return "const s: string = \"QQ\"\nexport const probe = " + c.expression("s") + "\n"
	}
	return "export function probe(s: string): string {\n  return " + c.expression("s") + "\n}\n"
}

func (c libOriginCase) files() map[string]string {
	config := map[string]any{
		"compilerOptions": map[string]any{"strict": true, "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "lib": c.project.lib, "types": c.project.types, "skipLibCheck": true, "noEmit": true},
		"files":           []string{"main.vibe", "twin.ts"},
	}
	encoded, _ := json.Marshal(config)
	return map[string]string{
		"tsconfig.json":                                       string(encoded),
		"main.vibe":                                           c.source(),
		"twin.ts":                                             "export const twin = " + c.callee + "(\"QQ\")\n",
		"package.json":                                        `{"type":"module"}`,
		"node_modules/@types/node/package.json":               `{"name":"@types/node","version":"26.6.5","types":"index.d.ts"}`,
		"node_modules/@types/node/index.d.ts":                 "/// <reference path=\"buffer.d.ts\" />\n/// <reference path=\"web-globals/blob.d.ts\" />\n",
		"node_modules/@types/node/buffer.d.ts":                libOriginBuffer,
		"node_modules/@types/node/web-globals/blob.d.ts":      libOriginNodeTypes,
		"node_modules/@cloudflare/workers-types/package.json": `{"name":"@cloudflare/workers-types","version":"5.20261027.1","types":"index.d.ts"}`,
		"node_modules/@cloudflare/workers-types/index.d.ts":   libOriginWorkersTypes,
	}
}

// libOriginInventory is the normative throws.json: Appendix E's annotation
// of every lib global.
type libOriginEntry struct {
	Module, Declaration, OwnThrows string
	Source                         struct{ File string }
}

func libOriginInventory(t testing.TB) []libOriginEntry {
	t.Helper()
	raw, err := os.ReadFile(SpecPath("../inventory/throws.json"))
	if err != nil {
		t.Fatal(err)
	}
	var inventory struct{ Entries []libOriginEntry }
	if err := json.Unmarshal(raw, &inventory); err != nil {
		t.Fatal(err)
	}
	return inventory.Entries
}

// libOriginOrigin names where decl comes from: a lib file's base name, or
// the package that declares it.
func libOriginOrigin(t *testing.T, r *Result, decl *ast.Node) (string, bool) {
	t.Helper()
	file := ast.GetSourceFileOfNode(decl)
	name := string(file.FileName())
	if r.Program.IsSourceFileDefaultLibrary(file.PathKey()) {
		return path.Base(name), true
	}
	for _, pkg := range []string{"@types/node", "@cloudflare/workers-types"} {
		if strings.Contains(name, "/node_modules/"+pkg+"/") {
			return pkg, false
		}
	}
	t.Fatalf("a declaration comes from %s, which no project here declares", name)
	return "", false
}

// libOriginThrown names the thrown type of the call the twin makes: the
// inventory's annotation when TypeScript selected a lib file's declaration,
// and "untagged" for a package's declaration with no @throws, whose thrown
// type is unknown without being known to throw. It also returns where the
// selected declaration comes from, and where every declaration of the callee
// does, which a callee passed as a value carries.
func libOriginThrown(t *testing.T, r *Result, callee string, inventory []libOriginEntry) (string, string, []string) {
	t.Helper()
	var twin *ast.SourceFile
	for _, file := range r.Program.SourceFiles() {
		if strings.HasSuffix(string(file.FileName()), "/twin.ts") {
			twin = file
		}
	}
	if twin == nil || len(twin.Statements.Nodes) == 0 {
		t.Fatal("twin.ts was not loaded")
	}
	statement := twin.Statements.Nodes[0]
	if !ast.IsVariableStatement(statement) {
		t.Fatal("twin.ts does not start with its const")
	}
	call := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Initializer()
	c, done := r.Program.GetTypeCheckerForFile(t.Context(), twin)
	defer done()
	signature := c.GetResolvedSignature(call)
	if signature == nil || signature.Declaration() == nil {
		t.Fatalf("TypeScript selected no declaration for %s", callee)
	}
	var origins []string
	if symbol := c.GetSymbolAtLocation(call.Expression()); symbol != nil {
		for _, decl := range symbol.Declarations() {
			if origin, _ := libOriginOrigin(t, r, decl); !slices.Contains(origins, origin) {
				origins = append(origins, origin)
			}
		}
	}
	slices.Sort(origins)
	origin, lib := libOriginOrigin(t, r, signature.Declaration())
	if !lib {
		return "untagged", origin, origins
	}
	for _, e := range inventory {
		if e.Module == "global" && e.Declaration == callee && path.Base(e.Source.File) == origin {
			return e.OwnThrows, origin, origins
		}
	}
	t.Fatalf("throws.json has no global %s from %s", callee, origin)
	return "", "", nil
}

// libOriginWant names the one diagnostic a cell expects, or none.
func libOriginWant(code int) string {
	if code == 0 {
		return "no error"
	}
	return fmt.Sprintf("only EK%04d", code)
}

func checkLibOrigin(t *testing.T, w *Workspace, inventory []libOriginEntry, c libOriginCase) {
	t.Helper()
	project, files := libOriginProjectFiles(c)
	r, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	thrown, origin, origins := libOriginThrown(t, r, c.callee, inventory)
	// A called callee throws what TypeScript's selected declaration says. A
	// callee passed to map is a value with every declaration's signature,
	// and Chapter 3 does not say which overload's contract a passed
	// overloaded function brings, so where its declarations disagree
	// between known to throw and untagged, plain code may report EK0401 or
	// nothing. Both throw something other than never.
	class, either := "call", false
	if c.form == "map" {
		class = "callback"
		if len(origins) > 1 {
			origin, either = strings.Join(origins, "+"), true
		}
	}
	want := 0
	switch c.host {
	case "plain", "top":
		if thrown != "never" && thrown != "untagged" {
			want = 401
		}
		if either {
			want = 401
		}
	case "effectful":
		if thrown != "never" {
			want = 401
		}
	case "effect":
		if thrown != "never" {
			want = 403
		}
	}
	got := 0
	var others []string
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if want != 0 && d.Source() == "EK" && int(d.Code()) == want {
			got++
			continue
		}
		others = append(others, describe(d))
	}
	// The gap is the contract the compiler gives one declaration, called or
	// passed, in one kind of host: a lib global's row names its callee, and
	// an untagged package declaration is the same for every callee.
	contract := origin
	if thrown != "untagged" && !either {
		contract = c.callee + "@" + origin
	}
	gap := contract + "/" + class + "/" + c.host
	switch {
	case want != 0 && got == 0 && !(either && c.host != "effectful" && c.host != "effect" && len(others) == 0):
		Gap(t, libOriginTarget, gap, "VIP-4: cell %s: %s from %s throws %s, so the %s call in the %s host is EK%04d; the compiler reports none (other errors: %s)\n%s", c.key, c.callee, origin, thrown, c.form, c.host, want, strings.Join(others, "; "), Archive(files))
	case len(others) > 0:
		Gap(t, libOriginTarget, gap, "VIP-4: cell %s: %s from %s throws %s, so the %s call in the %s host wants %s; unexpected errors: %s\n%s", c.key, c.callee, origin, thrown, c.form, c.host, libOriginWant(want), strings.Join(others, "; "), Archive(files))
	}
	ExpectPending(t, libOriginTarget, gap)
}

// libOriginProjectFiles is the project of one cell, as Compile takes it.
func libOriginProjectFiles(c libOriginCase) (Project, map[string]string) {
	files := c.files()
	project := Project{Config: files["tsconfig.json"], Files: map[string]string{}}
	for name, text := range files {
		if name != "tsconfig.json" {
			project.Files[name] = text
		}
	}
	return project, files
}

// TestLibOriginThrowsWitness compiles the Smithers minimum: HTTP Basic
// credentials made with btoa over encodeURIComponent in two plain arrows
// whose return type is wholly effectful, once inline and once through
// Array.prototype.map. btoa throws DOMException from lib.dom.d.ts and
// unknown from either package, never never, so each arrow is EK0401 in
// every project the witness names.
func TestLibOriginThrowsWitness(t *testing.T) {
	TestLibOriginThrowsQuoted(t)
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "smithers-btoa-basic-credentials.json"))
	if err != nil {
		t.Fatal(err)
	}
	var witness struct {
		Source, Main string
		Projects     []string
	}
	if err := json.Unmarshal(raw, &witness); err != nil {
		t.Fatal(err)
	}
	w := NewWorkspace(t)
	for _, name := range witness.Projects {
		i := slices.IndexFunc(libOriginProjects, func(p libOriginProject) bool { return p.name == name })
		if i < 0 {
			t.Fatalf("witness names unknown project %q", name)
		}
		t.Run(name, func(t *testing.T) {
			project, files := libOriginProjectFiles(libOriginCase{project: libOriginProjects[i], callee: "btoa"})
			project.Files["main.vibe"] = witness.Main
			files["main.vibe"] = witness.Main
			r, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			second := strings.Index(witness.Main, "export const githubBasic")
			found := [2]bool{}
			var others []string
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == "EK" && d.Code() == 401 && d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/main.vibe") {
					found[min(d.Pos()/max(second, 1), 1)] = true
					continue
				}
				others = append(others, describe(d))
			}
			key := "witness:smithers-btoa-basic-credentials/" + name
			if !found[0] || !found[1] || len(others) > 0 {
				Gap(t, libOriginTarget, key, "VIP-4: %s: want EK0401 in basicCredentials and githubBasic, got %v; other errors: %s\n%s", witness.Source, found, strings.Join(others, "; "), Archive(files))
			}
			ExpectPending(t, libOriginTarget, key)
		})
	}
}

func TestLibOriginThrowsQuoted(t *testing.T) {
	for _, q := range libOriginQuotes {
		r4Quoted(t, q.chapter, q.text)
	}
}

func FuzzLibOriginThrows(f *testing.F) {
	startShortBudget(f)
	cases := libOriginCases()
	for _, key := range []string{"dom/btoa/call/plain", "node/btoa/call/effect", "dom+node/btoa/conditional/effectful", "dom+workers/atob/map/try", "workers/encodeURIComponent/call/top"} {
		f.Add(key)
	}
	w := NewWorkspace(f)
	inventory := libOriginInventory(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestLibOriginThrowsQuoted(t)
		i := slices.IndexFunc(cases, func(c libOriginCase) bool { return c.key == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		checkLibOrigin(t, w, inventory, cases[i])
		ExpectPending(t, libOriginTarget, specCorpusKey(t))
	})
}

func TestLibOriginThrowsNeighborhood(t *testing.T) {
	if testing.Short() && os.Getenv("VIBELANG_LIB_ORIGIN_MATRIX") == "" {
		t.Skip("the complete project, callee, form and host matrix runs separately")
	}
	TestLibOriginThrowsQuoted(t)
	w := NewWorkspace(t)
	inventory := libOriginInventory(t)
	for _, c := range libOriginCases() {
		t.Run(c.key, func(t *testing.T) { checkLibOrigin(t, w, inventory, c) })
	}
}

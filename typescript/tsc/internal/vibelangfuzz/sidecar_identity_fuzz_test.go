package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// sidecarIdentityQuote and sidecarExportQuote are Chapter 7's rule.
const (
	sidecarDiscoveryQuote     = "A compatibility sidecar is an emit output: when `include` or default discovery selects both `x.vibe` and `x.d.vibe.ts`, the source wins and the sidecar leaves the program, as discovery selects `x.ts` ahead of `x.d.ts`."
	sidecarExplicitInputQuote = "A sidecar explicitly listed in `files` remains an input."
	sidecarOverwriteQuote     = "If the compatibility write would overwrite it, the compiler reports native `TS5055` (`Cannot write file … because it would overwrite input file`), exits `1` and leaves its bytes unchanged."
	sidecarIdentityQuote      = "VibeLang resolves a relative `./x.vibe` to source; plain `tsc` reads the compatibility declaration."
	sidecarExportQuote        = "A package specifier that lands on `x.d.vibe.ts`, as a `types` export does, resolves to `x.vibe` when the source is beside it outside `node_modules`, so the sidecar and the source are one module"
)

// FuzzSidecarIdentity enforces sidecarExportQuote: a consumer that reaches a
// nominal class through a package's sidecar export and through the source
// sees one class. The input picks the class (a private field, a unique symbol
// key, a generic), the package's export (explicit conditions, a wildcard, a
// nested wildcard, the root), the layout (a workspace symlink, a scoped one,
// a package importing itself), the second route to the source (a .ts or .vibe
// module importing it, a re-export), how the consumer meets both types, the
// consumer's language, and whether the sidecar is fresh or stale. alchemy's
// alchemy/Stage and opencode's layer-node are the corpus files.
func FuzzSidecarIdentity(f *testing.F) {
	startShortBudget(f)
	sidecarIdentityRule(f)
	for _, class := range sidecarClasses {
		for _, export := range sidecarExports {
			f.Add([]byte("sidecar:" + class.name + "/" + export.name + "/workspace/ts/pass/ts/fresh"))
		}
	}
	for _, layout := range sidecarLayouts {
		for _, route := range sidecarRoutes {
			for _, use := range sidecarUses {
				f.Add([]byte("sidecar:private/explicit/" + layout.name + "/" + route.name + "/" + use.name + "/vibe/stale"))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckSidecarIdentity(t, w, parseSidecar(data))
	})
}

// TestSidecarIdentityQuoted fails when Chapter 7 is reworded (RULES.md 9).
func TestSidecarIdentityQuoted(t *testing.T) { sidecarIdentityRule(t) }

func sidecarIdentityRule(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		tb.Fatal(err)
	}
	for _, quote := range []string{sidecarDiscoveryQuote, sidecarExplicitInputQuote, sidecarOverwriteQuote, sidecarIdentityQuote, sidecarExportQuote} {
		if !strings.Contains(string(text), quote) {
			tb.Fatalf("Chapter 7 no longer says %q", quote)
		}
	}
}

// A sidecarClass is one module: its source and its fresh sidecar. S<T> is the
// spelling the consumer uses (T is empty unless the class is generic).
type sidecarClass struct{ name, source, sidecar, ref string }

var sidecarClasses = []sidecarClass{
	{"private",
		"export class Stage { private readonly brand = 1; constructor(readonly name: string) {} }\n",
		"export declare class Stage {\n    readonly name: string;\n    private readonly brand;\n    constructor(name: string);\n}\n",
		"Stage"},
	{"symbol",
		"const Id = Symbol(\"id\")\nexport class Stage { readonly [Id] = true; constructor(readonly name: string) {} }\n",
		"declare const Id: unique symbol;\nexport declare class Stage {\n    readonly name: string;\n    readonly [Id]: true;\n    constructor(name: string);\n}\nexport {};\n",
		"Stage"},
	{"generic",
		"export class Stage<A = string> { private readonly held: A | undefined = undefined; constructor(readonly name: string) {} }\n",
		"export declare class Stage<A = string> {\n    readonly name: string;\n    private readonly held;\n    constructor(name: string);\n}\n",
		"Stage<number>"},
	{"protected",
		"export class Stage { protected readonly brand = 1; constructor(readonly name: string) {} }\n",
		"export declare class Stage {\n    readonly name: string;\n    protected readonly brand: number;\n    constructor(name: string);\n}\n",
		"Stage"},
}

type sidecarChoice struct{ name, text string }

// Each text is the package's "exports"; $USE is the export of src/Use.*.
var sidecarExports = []sidecarChoice{
	{"explicit", `{"./Stage":{"types":"./src/Stage.d.vibe.ts","default":"./src/Stage.vibe"},"./Use":$USE}`},
	{"wildcard", `{"./*":{"types":"./src/*.d.vibe.ts","default":"./src/*.vibe"},"./Use":$USE}`},
	{"nested", `{"./sub/*":{"types":"./src/sub/*.d.vibe.ts","default":"./src/sub/*.vibe"},"./Use":$USE}`},
	{"root", `{".":{"types":"./src/Stage.d.vibe.ts","default":"./src/Stage.vibe"},"./Use":$USE}`},
}

var sidecarLayouts = []sidecarChoice{
	{"workspace", "lib"},
	{"scoped", "@scope/lib"},
	{"self", "lib"},
}

// $S is the relative specifier of the source from src/Use.*.
var sidecarRoutes = []sidecarChoice{
	{"ts", "import { Stage } from \"$S\"\nexport const use = (s: $T): string => s.name\nexport const make = (): $T => new Stage(\"x\")\n"},
	{"vibe", "import { Stage } from \"$S\"\nexport const use = (s: $T): string => s.name\nexport const make = (): $T => new Stage(\"x\")\n"},
	{"reexport", "import { Stage } from \"$S\"\nexport { Stage }\nexport const use = (s: $T): string => s.name\nexport const make = (): $T => new Stage(\"x\")\n"},
}

// $T is the class as the consumer writes it, through the package export.
var sidecarUses = []sidecarChoice{
	{"pass", "export const run = (s: $T): string => use(s)\n"},
	{"return", "export const held: $T = make()\n"},
	{"array", "export const all: ReadonlyArray<$T> = [make()]\n"},
	{"inferred", "export const made = make()\nexport const first = (s: $T) => [s, made]\n"},
}

var sidecarSidecars = []sidecarChoice{{"fresh", ""}, {"stale", ""}}

var sidecarLanguages = []sidecarChoice{{"ts", "a.ts"}, {"vibe", "a.vibe"}}

type sidecarInput struct {
	class                  sidecarClass
	export, layout, route  sidecarChoice
	use, consumer, sidecar sidecarChoice
}

func (in sidecarInput) key() string {
	return strings.Join([]string{in.class.name, in.export.name, in.layout.name, in.route.name, in.use.name, in.consumer.name, in.sidecar.name}, "/")
}

// parseSidecar reads `sidecar:<class>/<export>/<layout>/<route>/<use>/<consumer>/<sidecar>`
// (RULES.md 11), and otherwise picks from the bytes.
func parseSidecar(data []byte) sidecarInput {
	find := func(choices []sidecarChoice, name string) sidecarChoice {
		for _, c := range choices {
			if c.name == name {
				return c
			}
		}
		return choices[0]
	}
	if rest, ok := strings.CutPrefix(string(data), "sidecar:"); ok {
		parts := append(strings.Split(rest, "/"), "", "", "", "", "", "", "")
		class := sidecarClasses[0]
		for _, c := range sidecarClasses {
			if c.name == parts[0] {
				class = c
			}
		}
		return sidecarInput{class, find(sidecarExports, parts[1]), find(sidecarLayouts, parts[2]), find(sidecarRoutes, parts[3]), find(sidecarUses, parts[4]), find(sidecarLanguages, parts[5]), find(sidecarSidecars, parts[6])}
	}
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	return sidecarInput{sidecarClasses[at(0)%len(sidecarClasses)], sidecarExports[at(1)%len(sidecarExports)], sidecarLayouts[at(2)%len(sidecarLayouts)], sidecarRoutes[at(3)%len(sidecarRoutes)], sidecarUses[at(4)%len(sidecarUses)], sidecarLanguages[at(5)%len(sidecarLanguages)], sidecarSidecars[at(6)%len(sidecarSidecars)]}
}

// paths returns the module's directory under src and the specifier after the
// package name.
func (in sidecarInput) paths() (dir, subpath string) {
	switch in.export.name {
	case "nested":
		return "sub/", "/sub/Stage"
	case "root":
		return "", ""
	}
	return "", "/Stage"
}

// project writes the package and the consumer. A workspace package sits in
// lib/ and the project links it into node_modules (link names the link); a
// package importing itself is the project.
func (in sidecarInput) project() (files map[string]string, consumer, link string) {
	dir, subpath := in.paths()
	name := in.layout.text
	pkg, src := "lib/", "src/"
	consumerDir := ""
	if in.layout.name == "self" {
		pkg, consumerDir = "", "src/"
	} else {
		link = "node_modules/" + name
	}
	files = map[string]string{"package.json": `{"type":"module"}`}
	useName, useExport := "Use.ts", `"./src/Use.ts"`
	if in.route.name == "vibe" {
		useName, useExport = "Use.vibe", `{"types":"./src/Use.d.vibe.ts","default":"./src/Use.vibe"}`
	}
	files[pkg+"package.json"] = fmt.Sprintf(`{"name":%q,"type":"module","exports":%s}`, name, strings.ReplaceAll(in.export.text, "$USE", useExport))
	sidecar := in.class.sidecar
	if in.sidecar.name == "stale" {
		// A sidecar from before name existed: a consumer reading it fails.
		sidecar = strings.ReplaceAll(sidecar, "    readonly name: string;\n", "")
	}
	files[pkg+src+dir+"Stage.vibe"] = in.class.source
	files[pkg+src+dir+"Stage.d.vibe.ts"] = sidecar
	specifier := "./" + dir + "Stage.vibe"
	files[pkg+src+useName] = strings.NewReplacer("$S", specifier, "$T", in.class.ref).Replace(in.route.text)
	if useName == "Use.vibe" {
		files[pkg+src+"Use.d.vibe.ts"] = "import { Stage } from \"" + specifier + "\";\nexport declare const use: (s: " + in.class.ref + ") => string;\nexport declare const make: () => " + in.class.ref + ";\n"
	}
	consumer = consumerDir + in.consumer.text
	files[consumer] = "import type { Stage } from \"" + name + subpath + "\"\nimport { use, make } from \"" + name + "/Use\"\n" +
		strings.ReplaceAll(in.use.text, "$T", in.class.ref) + "export const touch = (s: " + in.class.ref + "): string => s.name + use(make())\n"
	return files, consumer, link
}

const sidecarConfigFormat = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"outDir":"out","rootDir":".","allowArbitraryExtensions":true,"allowImportingTsExtensions":true},"files":[%q]}`

// CheckSidecarIdentity compiles the consumer: every error is the rule's
// failure, the program holds the source and not the sidecar, and the
// consumer's emit covers the consumer alone.
func CheckSidecarIdentity(t *testing.T, w *Workspace, in sidecarInput) {
	const target = "FuzzSidecarIdentity"
	defer recoverCompilerPanic(t, target)
	files, consumer, link := in.project()
	project := Project{Files: files, Config: fmt.Sprintf(sidecarConfigFormat, consumer)}
	g := &Gaps{Target: target, Input: "sidecar:" + in.key() + "\n" + files[consumer]}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	dir, err := w.writeProject(project)
	if err != nil {
		t.Fatal(err)
	}
	if link != "" {
		target := filepath.Join(dir, filepath.FromSlash(link))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatal(err)
		}
		rel, err := filepath.Rel(filepath.Dir(target), filepath.Join(dir, "lib"))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(rel, target); err != nil {
			t.Fatal(err)
		}
	}
	c := w.CompileIn(t.Context(), dir, project, OrderTsc, true)
	defer c.Remove()
	var errors []string
	for _, d := range c.Diagnostics {
		if d.Category().Name() == "error" {
			errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
		}
	}
	slices.Sort(errors)
	var sidecars []string
	if c.Program != nil {
		for _, file := range c.Program.SourceFiles() {
			if name := string(file.FileName()); strings.HasSuffix(name, "/Stage.d.vibe.ts") {
				sidecars = append(sidecars, strings.TrimPrefix(name, filepath.ToSlash(dir)+"/"))
			}
		}
	}
	if len(errors) > 0 || len(sidecars) > 0 {
		g.Add("feature:sidecar-identity", "Chapter 7: %q.\nerrors: %v\nsidecars in the program: %v\n%s", sidecarExportQuote, errors, sidecars, files[consumer])
	}
	var outputs []string
	for name := range c.Outputs {
		if strings.Contains(name, "Stage") {
			outputs = append(outputs, name)
		}
	}
	slices.Sort(outputs)
	// A package importing itself is the project, and emits its own modules.
	if len(outputs) > 0 && in.layout.name != "self" {
		g.Add("feature:sidecar-emit", "The package's modules stay the package's: the consumer emits only itself; got %v", outputs)
	}
	g.FinishInput(t, key)
}

package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/execute"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// VIP-27's Location rule is the oracle: the sidecar exists "so plain `tsc`
// and TypeDoc understand `.vibe` imports". A .ts file that keeps the
// specifier it wrote when its target was TypeScript, ./x.js, ./x or ./x.ts,
// must therefore check under stock tsc exactly as it did before the target
// became x.vibe: the same diagnostics, and a byte-identical declaration of
// the importer. This compares stock tsc with itself on the two projects the
// rule says must agree, and VibeLang's checker with stock tsc on the
// original.
const nativeSidecarQuote = "so plain `tsc` and TypeDoc understand `.vibe` imports"

// Chapter 7 keeps a written ./x.ts on native candidates. Before the first
// build a converted target has none; the native declaration it then gets is
// one.
const nativeSidecarStaleTsQuote = "A written `./x.ts` keeps native substitutions, including `x.tsx` and `x.d.ts`, but never falls back to VibeLang source; no native candidate means `TS2307`."

func TestNativeSidecarImportsQuoted(t *testing.T) {
	text, err := os.ReadFile(filepath.Join(Root(), "docs/design/vips/0027-declaration-output.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), nativeSidecarQuote) {
		t.Fatal(nativeSidecarQuote)
	}
	if !strings.Contains(SpecText("007-tooling.md"), nativeSidecarStaleTsQuote) {
		t.Fatal(nativeSidecarStaleTsQuote)
	}
}

// nativeSidecarModule is one module of a generated project: TypeScript in
// the original, and VibeLang in the converted project when vibe is set.
type nativeSidecarModule struct {
	name string // stem under src/
	jsx  bool   // .tsx or .vibex
	vibe bool
	text string
}

type nativeSidecarProject struct {
	resolution   string // bundler or nodenext
	skipLibCheck bool
	sidecarDir   bool
	tsExtensions bool // allowImportingTsExtensions
	staleTs      bool // a .ts file names a VibeLang module ./x.ts or ./x.tsx
	modules      []nativeSidecarModule
}

func (m nativeSidecarModule) file(converted bool) string {
	extension := ".ts"
	switch {
	case converted && m.vibe && m.jsx:
		extension = ".vibex"
	case converted && m.vibe:
		extension = ".vibe"
	case m.jsx:
		extension = ".tsx"
	}
	return "src/" + m.name + extension
}

type nativeSidecarObservation struct {
	Codes        []string
	Declarations map[string]string
}

func nativeSidecarStock(tb testing.TB) string {
	tb.Helper()
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = filepath.Join(Root(), "experiments", "node_modules")
	}
	stock := filepath.Join(modules, "typescript", "bin", "tsc")
	if _, err := os.Stat(stock); err != nil {
		Missing(tb, "install experiments dependencies: %v", err)
	}
	return stock
}

func (project nativeSidecarProject) config() map[string]any {
	module := "esnext"
	if project.resolution == "nodenext" {
		module = "nodenext"
	}
	options := map[string]any{
		"target": "es2022", "module": module, "moduleResolution": project.resolution, "strict": true,
		"types": []string{}, "jsx": "preserve", "allowArbitraryExtensions": true,
		"skipLibCheck": project.skipLibCheck, "allowImportingTsExtensions": project.tsExtensions,
		"declaration": true, "emitDeclarationOnly": true, "outDir": "dist", "rootDir": ".",
	}
	config := map[string]any{"compilerOptions": options, "include": []string{"src"}}
	vibe := map[string]any{"effectGlobals": false, "effectModules": false}
	if project.sidecarDir {
		options["rootDirs"] = []string{".", ".vibe/declarations"}
		vibe["sidecarDir"] = ".vibe/declarations"
	}
	config["vibe"] = vibe
	return config
}

func writeNativeSidecarProject(t *testing.T, dir string, project nativeSidecarProject, converted bool) {
	t.Helper()
	config, err := json.Marshal(project.config())
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{"package.json": `{"type":"module"}`, "tsconfig.json": string(config)}
	for _, module := range project.modules {
		files[module.file(converted)] = module.text
	}
	for name, text := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func runNativeSidecarStock(t *testing.T, stock, dir, outDir string) nativeSidecarObservation {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", stock, "-p", dir, "--pretty", "false", "--outDir", filepath.Join(dir, outDir))
	out, _ := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatal("stock tsc timed out")
	}
	return nativeSidecarObservation{Codes: nativeSidecarCodes(string(out)), Declarations: nativeSidecarDeclarations(t, filepath.Join(dir, outDir))}
}

func runNativeSidecarVibeLang(t *testing.T, dir string) []string {
	t.Helper()
	sys := &sidecarLayoutSystem{&sidecarParitySystem{fs: bundled.WrapFS(osvfs.FS()), cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(dir))}}
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	execute.CommandLine(ctx, sys, []string{"-p", ".", "--pretty", "false"}, nil)
	if ctx.Err() != nil {
		t.Fatal("VibeLang timed out")
	}
	return nativeSidecarCodes(sys.output.String())
}

func nativeSidecarCodes(output string) []string {
	codes := []string{}
	for _, match := range sidecarLayoutCodes.FindAllStringSubmatch(output, -1) {
		code := match[1]
		// NodeNext's missing-extension error adds "Did you mean './x.js'?"
		// only where x.ts exists: one error either way.
		if code == "TS2835" {
			code = "TS2834"
		}
		codes = append(codes, code)
	}
	slices.Sort(codes)
	return slices.Compact(codes)
}

// nativeSidecarDeclarations reads the declarations stock tsc wrote for the
// native modules, which both projects share.
func nativeSidecarDeclarations(t *testing.T, dir string) map[string]string {
	t.Helper()
	declarations := map[string]string{}
	filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err == nil && !entry.IsDir() && strings.HasPrefix(entry.Name(), "native") {
			text, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			name, _ := filepath.Rel(dir, path)
			declarations[filepath.ToSlash(name)] = string(text)
		}
		return nil
	})
	return declarations
}

// checkNativeSidecarProject converts the project's VibeLang modules, runs
// VibeLang there, and compares stock tsc on both projects.
func checkNativeSidecarProject(t *testing.T, target, key string, project nativeSidecarProject) {
	t.Helper()
	stock := nativeSidecarStock(t)
	original, converted := t.TempDir(), t.TempDir()
	writeNativeSidecarProject(t, original, project, false)
	writeNativeSidecarProject(t, converted, project, true)
	before := runNativeSidecarStock(t, stock, original, "stock")
	vibe := runNativeSidecarVibeLang(t, converted)
	after := runNativeSidecarStock(t, stock, converted, "stock")
	describe := func() string {
		var lines []string
		for _, module := range project.modules {
			lines = append(lines, fmt.Sprintf("// %s\n%s", module.file(true), module.text))
		}
		config, _ := json.Marshal(project.config())
		return string(config) + "\n" + strings.Join(lines, "\n")
	}
	if !slices.Equal(before.Codes, after.Codes) {
		Gap(t, target, key, "%s: stock tsc on the original reports %v, on the converted project %v\n%s", nativeSidecarQuote, before.Codes, after.Codes, describe())
	}
	if len(before.Declarations) == 0 || !mapsEqual(before.Declarations, after.Declarations) {
		Gap(t, target, key, "%s: native declarations differ\noriginal %v\nconverted %v\n%s", nativeSidecarQuote, before.Declarations, after.Declarations, describe())
	}
	if project.staleTs {
		// The first build finds no native candidate for a stale ./x.ts; the
		// second reads the native declaration, as stock tsc does.
		if !slices.Contains(vibe, "TS2307") || slices.ContainsFunc(vibe, func(code string) bool { return code != "TS2307" && !slices.Contains(before.Codes, code) }) {
			Gap(t, target, key, "%s: before the first build VibeLang reports %v, want TS2307 and at most the original's %v\n%s", nativeSidecarStaleTsQuote, vibe, before.Codes, describe())
		}
		vibe = runNativeSidecarVibeLang(t, converted)
		if !slices.Equal(after.Codes, vibe) {
			Gap(t, target, key, "%s: after the first build stock tsc reports %v, VibeLang %v\n%s", nativeSidecarStaleTsQuote, after.Codes, vibe, describe())
		}
	} else if !slices.Equal(before.Codes, vibe) {
		Gap(t, target, key, "%s: stock tsc on the original reports %v, VibeLang on the converted project %v\n%s", nativeSidecarQuote, before.Codes, vibe, describe())
	}
	ExpectPending(t, target, key)
}

func mapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for key, value := range a {
		if other, ok := b[key]; !ok || other != value {
			return false
		}
	}
	return true
}

// nativeSidecarSpellings are the ways a .ts importer names a module it
// wrote when the module was TypeScript.
var nativeSidecarSpellings = []string{"js", "extensionless", "ts"}

func nativeSidecarSpecifier(name string, jsx bool, spelling string) string {
	switch spelling {
	case "extensionless":
		return "./" + name
	case "ts":
		if jsx {
			return "./" + name + ".tsx"
		}
		return "./" + name + ".ts"
	}
	if jsx {
		return "./" + name + ".jsx"
	}
	return "./" + name + ".js"
}

// The fixed matrix: a module with a nominal class, a default export and an
// import type, a second VibeLang module that names the class through its own
// import, so its sidecar refers to the first module by source, and a .vibex
// module, all imported by one native file under each spelling.
func nativeSidecarMatrixProject(resolution string, skipLibCheck, sidecarDir, tsExtensions bool, spelling string) nativeSidecarProject {
	x := func(name string) string { return nativeSidecarSpecifier(name, false, spelling) }
	app := nativeSidecarSpecifier("app", true, spelling)
	consumer := strings.Join([]string{
		fmt.Sprintf("import tag, { Box, make, answer } from %q;", x("x")),
		fmt.Sprintf("import { useBox, fromY } from %q;", x("y")),
		fmt.Sprintf("import { title } from %q;", app),
		fmt.Sprintf("export * from %q;", x("x")),
		fmt.Sprintf("export { useBox as use } from %q;", x("y")),
		fmt.Sprintf("export type Imported = import(%q).Box;", x("x")),
		"export const total = useBox(make()) + answer + tag.length + title.length;",
		"export const box: Box = fromY;",
		"export const made = make();",
		"",
	}, "\n")
	return nativeSidecarProject{resolution: resolution, skipLibCheck: skipLibCheck, sidecarDir: sidecarDir, tsExtensions: tsExtensions, staleTs: spelling == "ts", modules: []nativeSidecarModule{
		{name: "x", vibe: true, text: "export class Box {\n  private secret = 1\n  readonly v: number = 1\n}\nexport function make(): Box {\n  return new Box()\n}\nexport const answer: number = 42\nconst tag = \"x\"\nexport default tag\n"},
		{name: "y", vibe: true, text: "import { Box, make } from \"./x.js\"\nexport function useBox(b: Box): number {\n  return b.v\n}\nexport const fromY: Box = make()\n"},
		{name: "app", jsx: true, vibe: true, text: "export const title: string = \"app\"\n"},
		{name: "native", text: consumer},
	}}
}

func TestNativeSidecarStockMatrix(t *testing.T) {
	for _, resolution := range []string{"bundler", "nodenext"} {
		for _, skipLibCheck := range []bool{true, false} {
			for _, sidecarDir := range []bool{false, true} {
				for _, spelling := range nativeSidecarSpellings {
					for _, tsExtensions := range []bool{false, true} {
						if tsExtensions && spelling != "ts" {
							continue
						}
						key := fmt.Sprintf("native-sidecar:%s:skipLibCheck=%t:sidecarDir=%t:%s:allowImportingTsExtensions=%t", resolution, skipLibCheck, sidecarDir, spelling, tsExtensions)
						t.Run(key, func(t *testing.T) {
							t.Parallel()
							checkNativeSidecarProject(t, "TestNativeSidecarStockMatrix", key, nativeSidecarMatrixProject(resolution, skipLibCheck, sidecarDir, tsExtensions, spelling))
						})
					}
				}
			}
		}
	}
}

// FuzzNativeSidecarGraphs generates module graphs mixing TypeScript and
// VibeLang modules, each importing earlier ones with every spelling a .ts
// file may use, and passing values between them so nominal identity
// matters. The key is the layout and resolution; the bytes choose the
// graph.
func FuzzNativeSidecarGraphs(f *testing.F) {
	startShortBudget(f)
	keys := []string{"bundler:beside", "bundler:sidecarDir", "nodenext:beside", "nodenext:sidecarDir"}
	for i, key := range keys {
		f.Add(key, []byte{byte(i), 3, 0x5a, 0xc3, 0x0f})
		f.Add(key, []byte{byte(i + 7), 5, 0xa5, 0x3c, 0xf0, 0x99})
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		if !slices.Contains(keys, key) {
			index := 0
			if len(key) > 0 {
				index = int(key[0]) % len(keys)
			}
			key = keys[index]
		}
		resolution, layout, _ := strings.Cut(key, ":")
		var seed [32]byte
		copy(seed[:], data)
		random := rand.New(rand.NewChaCha8(seed))
		count := 2 + random.IntN(4)
		project := nativeSidecarProject{resolution: resolution, sidecarDir: layout == "sidecarDir", skipLibCheck: random.IntN(2) == 0, tsExtensions: random.IntN(2) == 0}
		// What export * does not carry, chosen per module: a default export,
		// a global, and an augmentation of an earlier module's interface,
		// beside a type export and a namespace.
		defaults := make([]bool, count)
		globals := make([]bool, count)
		augmented := make([][]int, count) // module -> modules that augment it
		for i := range count {
			name := fmt.Sprintf("m%d", i)
			module := nativeSidecarModule{name: name, vibe: i == 0 || random.IntN(2) == 0, jsx: random.IntN(5) == 0}
			lines := []string{
				fmt.Sprintf("export class C%d {\n  private brand%d = %d\n}", i, i, i),
				fmt.Sprintf("export function make%d(): C%d {\n  return new C%d()\n}", i, i, i),
				fmt.Sprintf("export interface I%d {\n  base%d: number\n}", i, i),
				fmt.Sprintf("export type T%d = C%d", i, i),
				fmt.Sprintf("export namespace N%d {\n  export const v: number = %d\n}", i, i),
			}
			if defaults[i] = random.IntN(2) == 0; defaults[i] {
				lines = append(lines, fmt.Sprintf("const d%d: number = %d\nexport default d%d", i, i, i))
			}
			if globals[i] = random.IntN(3) == 0; globals[i] {
				lines = append(lines, fmt.Sprintf("declare global {\n  const g%d: number\n}", i))
			}
			if i > 0 && random.IntN(3) == 0 {
				j := random.IntN(i)
				augmented[j] = append(augmented[j], i)
				lines = append(lines, fmt.Sprintf("declare module %q {\n  interface I%d {\n    aug%d: boolean\n  }\n}", nativeSidecarSpecifier(project.modules[j].name, project.modules[j].jsx, "js"), j, i))
			}
			for j := range i {
				if random.IntN(2) == 0 {
					continue
				}
				dependency := project.modules[j]
				spelling := "js"
				if !module.vibe {
					spelling = nativeSidecarSpellings[random.IntN(len(nativeSidecarSpellings))]
					if resolution == "nodenext" && spelling == "extensionless" || spelling == "ts" && !project.tsExtensions {
						spelling = "js"
					}
					project.staleTs = project.staleTs || spelling == "ts" && dependency.vibe
				}
				lines = append(lines,
					fmt.Sprintf("import { C%d, make%d } from %q", j, j, nativeSidecarSpecifier(dependency.name, dependency.jsx, spelling)),
					fmt.Sprintf("export const from%dIn%d: C%d = make%d()", j, i, j, j),
					fmt.Sprintf("export function take%dIn%d(value: C%d): C%d {\n  return value\n}", j, i, j, j))
			}
			module.text = strings.Join(lines, "\n") + "\n"
			project.modules = append(project.modules, module)
		}
		// The native importer reaches every module, and passes each one's
		// value through every module that re-declared it.
		lines := []string{}
		for j, dependency := range project.modules {
			spelling := nativeSidecarSpellings[random.IntN(len(nativeSidecarSpellings))]
			if resolution == "nodenext" && spelling == "extensionless" || spelling == "ts" && !project.tsExtensions {
				spelling = "js"
			}
			project.staleTs = project.staleTs || spelling == "ts" && dependency.vibe
			lines = append(lines, fmt.Sprintf("import * as n%d from %q", j, nativeSidecarSpecifier(dependency.name, dependency.jsx, spelling)))
		}
		for i := range project.modules {
			for j := range i {
				if strings.Contains(project.modules[i].text, fmt.Sprintf("take%dIn%d", j, i)) {
					lines = append(lines, fmt.Sprintf("export const pass%dThrough%d = n%d.take%dIn%d(n%d.make%d())", j, i, i, j, i, j, j))
				}
			}
			lines = append(lines,
				fmt.Sprintf("export const made%d = n%d.make%d()", i, i, i),
				fmt.Sprintf("export const typed%d: n%d.T%d = n%d.make%d()", i, i, i, i, i),
				fmt.Sprintf("export const value%d: number = n%d.N%d.v", i, i, i))
			members := []string{fmt.Sprintf("base%d: 1", i)}
			for _, by := range augmented[i] {
				members = append(members, fmt.Sprintf("aug%d: true", by))
			}
			lines = append(lines, fmt.Sprintf("export const shape%d: n%d.I%d = { %s }", i, i, i, strings.Join(members, ", ")))
			if defaults[i] {
				lines = append(lines, fmt.Sprintf("export const default%d: number = n%d.default", i, i))
			}
			if globals[i] {
				lines = append(lines, fmt.Sprintf("export const global%d: number = g%d", i, i))
			}
		}
		project.modules = append(project.modules, nativeSidecarModule{name: "native", text: strings.Join(lines, "\n") + "\n"})
		checkNativeSidecarProject(t, "FuzzNativeSidecarGraphs", "native-sidecar-graph:"+key, project)
	})
}

// What a plain export * does not carry. Type-only exports, namespaces and
// namespace re-exports reach the importer through the re-export; global
// declarations and module augmentations stay only in the sidecar, so the
// importer sees each once. Each spelling and layout is checked against the
// original as in the matrix.
func nativeSidecarAugmentationProject(resolution string, skipLibCheck, sidecarDir bool, spelling string) nativeSidecarProject {
	x := func(name string) string { return nativeSidecarSpecifier(name, false, spelling) }
	consumer := strings.Join([]string{
		fmt.Sprintf("import { Ns, type Pair, type Shape, others } from %q;", x("x")),
		fmt.Sprintf("import type { Extended } from %q;", x("y")),
		fmt.Sprintf("export * from %q;", x("x")),
		"export const pair: Pair = [Ns.n, others.o];",
		"export const shape: Shape = { k: \"k\" };",
		"export const extended: Extended = { base: 1, added: true };",
		"export const mark: number = vibeMark;",
		"",
	}, "\n")
	return nativeSidecarProject{resolution: resolution, skipLibCheck: skipLibCheck, sidecarDir: sidecarDir, tsExtensions: spelling == "ts", staleTs: spelling == "ts", modules: []nativeSidecarModule{
		{name: "o", vibe: true, text: "export const o: number = 2\n"},
		{name: "y", vibe: true, text: "export interface Extended {\n  base: number\n}\n"},
		{name: "x", vibe: true, text: "export type Pair = [number, number]\nexport interface Shape {\n  k: string\n}\nexport namespace Ns {\n  export const n: number = 1\n}\nexport * as others from \"./o.js\"\ndeclare global {\n  const vibeMark: number\n}\ndeclare module \"./y.js\" {\n  interface Extended {\n    added: boolean\n  }\n}\n"},
		{name: "native", text: consumer},
	}}
}

func TestNativeSidecarStockAugmentations(t *testing.T) {
	for _, resolution := range []string{"bundler", "nodenext"} {
		for _, skipLibCheck := range []bool{true, false} {
			for _, sidecarDir := range []bool{false, true} {
				for _, spelling := range []string{"js", "ts"} {
					key := fmt.Sprintf("native-sidecar-augment:%s:skipLibCheck=%t:sidecarDir=%t:%s", resolution, skipLibCheck, sidecarDir, spelling)
					t.Run(key, func(t *testing.T) {
						t.Parallel()
						checkNativeSidecarProject(t, "TestNativeSidecarStockAugmentations", key, nativeSidecarAugmentationProject(resolution, skipLibCheck, sidecarDir, spelling))
					})
				}
			}
		}
	}
}

// A .vibe module cannot assign export =, but a compatibility declaration
// that did would get the import-require form, which stock tsc reads as the
// declaration itself: the same diagnostics and the same importer
// declaration as with the declaration at x.d.ts.
func TestNativeSidecarExportEqualsStock(t *testing.T) {
	stock := nativeSidecarStock(t)
	const sidecar = "declare const api: {\n    readonly b: 1;\n};\nexport = api;\n"
	run := func(native string) nativeSidecarObservation {
		dir := t.TempDir()
		files := map[string]string{
			"tsconfig.json":   `{"compilerOptions":{"module":"commonjs","moduleResolution":"node10","strict":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"allowArbitraryExtensions":true,"rootDir":"."},"include":["src"]}`,
			"src/native.ts":   "import api = require(\"./x.js\");\nexport const b = api.b;\nexport type Api = typeof api;\n",
			"src/x.d.ts":      native,
			"src/x.d.vibe.ts": sidecar,
		}
		for name, text := range files {
			path := filepath.Join(dir, filepath.FromSlash(name))
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		return runNativeSidecarStock(t, stock, dir, "stock")
	}
	forwarded := compiler.NativeDeclarationText("./x.vibe", sidecar)
	if !strings.Contains(forwarded, "export = ") {
		t.Fatalf("no export = form: %q", forwarded)
	}
	before, after := run(sidecar), run(forwarded)
	if len(before.Codes) != 0 || !slices.Equal(before.Codes, after.Codes) || !mapsEqual(before.Declarations, after.Declarations) {
		t.Fatalf("%s: copy %+v, re-export %+v", nativeSidecarQuote, before, after)
	}
}

package vibelang

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// TestModuleServiceDeclarations checks that a declaration file writes the
// type a module's name names, FileSystem, as the service's type,
// FileSystem.FileSystem, through a prelude module and through a module that
// is a member of a prelude namespace (D311), and that TypeScript, checking
// libraries, accepts it. The runtime's Control stands in for a namespace
// of modules such as Experimental.
func TestModuleServiceDeclarations(t *testing.T) {
	t.Parallel()
	files := computedKeyFiles(false)
	effect := "/Users/x/src/node_modules/effect/"
	runtime := "/Users/x/src/node_modules/vibelang-runtime/"
	files[effect+"package.json"] = `{"name":"effect","type":"module","exports":{".":{"types":"./index.d.ts"},"./ai":{"types":"./ai/index.d.ts"},"./*":{"types":"./*.d.ts"}}}`
	files[effect+"index.d.ts"] = `export * as Effect from "./Effect.js"; export * as Inspectable from "./Inspectable.js"; export * as FileSystem from "./FileSystem.js"; export * as Option from "./Option.js"`
	files[effect+"Option.d.ts"] = "export type Option<A> = { readonly _tag: \"Some\"; readonly value: A } | { readonly _tag: \"None\" }\nexport declare const some: <A>(value: A) => Option<A>\n"
	files[effect+"ai/index.d.ts"] = `export * as Prompt from "./Prompt.js"`
	files[effect+"ai/Prompt.d.ts"] = "export interface Prompt { readonly text: string }\nexport declare const make: (text: string) => Prompt\n"
	files[effect+"FileSystem.d.ts"] = "export interface FileSystem { readonly name: string }\n" +
		`export declare const FileSystem: { readonly "~effect/Context/Service": "~effect/Context/Service"; readonly Identifier: FileSystem; readonly Service: FileSystem }` + "\n" +
		"export declare const layerNoop: (fileSystem: Partial<FileSystem>) => FileSystem\n"
	files[runtime+"index.d.ts"] = `export * as Effect from "effect/Effect"; export * from "./match.js"; export * as Control from "./experimental.js"`
	files[runtime+"experimental.d.ts"] = `export * as FileSystem from "effect/FileSystem"`
	src := strings.TrimSuffix(effect, "node_modules/effect/") // the project directory
	files[src+"main.vibe"] = "export const name = (fs: FileSystem.FileSystem): infer _ => fs.name\n" +
		"export const experimental = (fs: Control.FileSystem): infer _ => fs.name\n" +
		"export const noop = FileSystem.layerNoop({})\n" +
		"export const local = <FileSystem>(fs: FileSystem): infer _ => fs\n" +
		"export const first = (value: Option<number>): infer _ => value\n" +
		"export const spelled = (value: Option.Option<number>): infer _ => value\n"
	files[src+"prompt.vibe"] = "import { Prompt } from \"effect/ai\"\nexport const text = (prompt: Prompt): string => prompt.text\n"
	files["/Users/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true},"files":["main.vibe","prompt.vibe"]}`
	dts := emitDeclarations(t, files)
	for _, want := range []string{
		`import { FileSystem as FileSystem_1, Option } from "effect";`,
		`import { Control } from "vibelang-runtime";`,
		`name: (fs: FileSystem_1.FileSystem) => string;`,
		`experimental: (fs: Control.FileSystem.FileSystem) => string;`,
		`local: <FileSystem>(fs: FileSystem) => FileSystem;`,
		`first: (value: Option.Option<number>) =>`,
		`spelled: (value: Option.Option<number>) =>`,
	} {
		if !strings.Contains(dts, want) {
			t.Fatalf("declaration lacks %q:\n%s", want, dts)
		}
	}
	prompt := emitDeclarationsOf(t, files, "prompt.d.ts")
	for _, want := range []string{`{ Prompt } from "effect/ai";`, `text: (prompt: Prompt.Prompt) => string;`} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("declaration lacks %q:\n%s", want, prompt)
		}
	}
	files["/Users/x/src/main.d.ts"] = dts
	files["/Users/x/src/prompt.d.ts"] = prompt
	delete(files, "/Users/x/src/main.vibe")
	delete(files, "/Users/x/src/prompt.vibe")
	files["/Users/x/src/consumer.ts"] = `import * as value from "./main.js"; import * as prompt from "./prompt.js"; export { value, prompt }`
	files["/Users/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"skipLibCheck":false,"module":"NodeNext","noEmit":true},"files":["consumer.ts"]}`
	for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("declaration consumer: %s\n%s", d.String(), dts)
		}
	}
}

// emitDeclarationsOf returns the declaration file named name that the
// program of files emits, failing on any error diagnostic.
func emitDeclarationsOf(t *testing.T, files map[string]string, name string) string {
	t.Helper()
	p := computedKeyProgram(t, files)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s", d.String())
		}
	}
	var dts string
	p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(file tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(file), "/"+name) {
			dts = text
		}
		return nil
	}})
	if dts == "" {
		t.Fatalf("no %s emitted", name)
	}
	return dts
}

// moduleServiceProgram compiles source as main.vibe against the installed
// effect and a runtime that adds Control, a namespace of modules as
// Experimental is, to the real runtime's exports, and returns the program,
// the file, and its emitted JavaScript.
func moduleServiceProgram(t *testing.T, source string) (*compiler.Program, *ast.SourceFile, string) {
	t.Helper()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	runtime := filepath.Join(dir, "runtime")
	for name, text := range map[string]string{
		"package.json":               `{"type":"module"}`,
		"tsconfig.json":              `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"outDir":"out","rootDir":"."},"files":["main.vibe"]}`,
		"main.vibe":                  source,
		"runtime/package.json":       `{"name":"vibelang-runtime","type":"module","exports":{".":{"types":"./index.d.ts","default":"./index.js"}}}`,
		"runtime/index.d.ts":         "export * from " + `"` + filepath.ToSlash(filepath.Join(root, "packages/runtime/dist/index.js")) + `"` + "\nexport * as Control from \"./experimental.js\"\n",
		"runtime/experimental.d.ts":  `export * as FileSystem from "effect/FileSystem"`,
		"runtime/node_modules/.keep": "",
		"node_modules/.keep":         "",
	} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	effect := filepath.Join(root, "packages/runtime/node_modules/effect")
	for _, link := range [][2]string{{effect, "node_modules/effect"}, {runtime, "node_modules/vibelang-runtime"}, {effect, "runtime/node_modules/effect"}} {
		if err := os.Symlink(link[0], filepath.Join(dir, link[1])); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	file := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe"))))
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s", d.String())
		}
	}
	var js string
	program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(name), "main.js") {
			js = text
		}
		return nil
	}})
	return program, file, js
}

// TestModuleServiceThroughPreludeNamespace checks D311 for a module that is
// a member of a prelude namespace, as Experimental.FileSystem is: a member
// the module does not export calls the service, the module called is the
// implementation, its exports keep their meaning, and the type is the
// service's.
func TestModuleServiceThroughPreludeNamespace(t *testing.T) {
	t.Parallel()
	_, _, js := moduleServiceProgram(t, "export function read(path: string) { return Control.FileSystem.readFileString(path) }\n"+
		"export function implementation() { return Control.FileSystem() }\n"+
		"export const noop = Control.FileSystem.layerNoop({})\n"+
		"export function exists(fs: Control.FileSystem, path: string) { return fs.exists(path) }\n")
	for _, want := range []string{
		"(yield* Control.FileSystem.FileSystem).readFileString(path)",
		"() => Control.FileSystem.FileSystem }",
		"Control.FileSystem.layerNoop({})",
	} {
		if !strings.Contains(js, want) {
			t.Fatalf("JavaScript lacks %q:\n%s", want, js)
		}
	}
}

// D311 in the editor: completions after FileSystem. list the module's
// exports and the service's members, and hover and go to definition on a
// member reach the service's declaration.
func TestEditorModuleServices(t *testing.T) {
	source := "export function read(path: string) {\n  return FileSystem.readFileString(path)\n}\n"
	program, file, _, converters := editorProgram(t, source)
	service := ls.NewLanguageService(nil, program, fixHost{program: program, converters: converters}, file.FileName().AsString())
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s", d.String())
		}
	}
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	access := findNode(file.AsNode(), func(n *ast.Node) bool { return ast.IsPropertyAccessExpression(n) })
	members := map[string]bool{}
	for _, symbol := range c.GetPropertiesOfType(serviceMemberCompletions(c, access.Expression(), c.GetTypeAtLocation(access.Expression()))) {
		members[symbol.Name()] = true
	}
	done()
	for _, name := range []string{"readFileString", "exists", "layerNoop", "makeNoop"} {
		if !members[name] {
			t.Errorf("completions after FileSystem. lack %s", name)
		}
	}
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	if text := hoverText(t, service, uri, positionOf(source, "readFileString", 1)); !strings.Contains(text, "readFileString") || !strings.Contains(text, "PlatformError") {
		t.Errorf("hover on readFileString = %q", text)
	}
	uris := definitionURIs(t, service, uri, positionOf(source, "readFileString", 1))
	if len(uris) == 0 || !strings.HasSuffix(uris[0], "/FileSystem.d.ts") {
		t.Errorf("definition of FileSystem.readFileString = %v, want effect's FileSystem.d.ts", uris)
	}
}

// TestModuleServicesDocumented finds, from the installed declarations, every
// module whose name names its service (D311), and the DOM interfaces whose
// bare names those modules take in a type, and checks the lists in the
// guide's page on Effect's modules.
func TestModuleServicesDocumented(t *testing.T) {
	var names []string
	for name := range effectRootNames {
		names = append(names, name)
	}
	for name := range effectSubpathNames {
		names = append(names, name)
	}
	slices.Sort(names)
	var source strings.Builder
	source.WriteString("export const all = [")
	for _, name := range names {
		if !slices.Contains([]string{"Array", "BigInt", "Boolean", "Function", "Number", "RegExp", "String", "Symbol"}, name) {
			source.WriteString(name + ", ")
		}
	}
	source.WriteString("]\n")
	program, file, _, _ := editorProgram(t, source.String())
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	var services, ambientTypes []string
	for _, name := range names {
		module := preludeSymbol(c, preludeStateOf(c), file, name)
		if moduleServiceKeyOf(c, module, name) != nil {
			services = append(services, "`"+name+"`")
		}
		if module != nil && c.GlobalSymbol(name, ast.SymbolFlagsType) != nil {
			ambientTypes = append(ambientTypes, "`"+name+"`")
		}
	}
	done()
	if len(services) < 10 {
		t.Fatalf("found %d modules that name a service: %v", len(services), services)
	}
	page, err := os.ReadFile("../../../../docs/user/src/getting-started/008-importing-effect.md")
	if err != nil {
		t.Fatal(err)
	}
	block := func(marker string) string {
		_, rest, ok := strings.Cut(string(page), "<!-- "+marker+": TestModuleServicesDocumented checks this list -->\n")
		list, _, ok2 := strings.Cut(rest, "\n<!-- end "+marker+" -->")
		if !ok || !ok2 {
			t.Fatalf("the page lacks the %s list", marker)
		}
		return list
	}
	if got, want := block("D311 services"), strings.Join(services, ", ")+"."; got != want {
		t.Errorf("the page's list of modules that name a service is\n%s\nthe installed effect gives\n%s", got, want)
	}
	if got, want := block("D311 DOM types"), strings.Join(ambientTypes, ", ")+"."; got != want {
		t.Errorf("the page's list of ambient types whose names also name Effect namespaces is\n%s\nthe installed effect gives\n%s", got, want)
	}
}

// findNode returns the first node under root, in source order, that match
// accepts, or nil.
func findNode(root *ast.Node, match func(*ast.Node) bool) *ast.Node {
	var found *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if match(n) {
			found = n
			return true
		}
		return n.ForEachChild(visit)
	}
	root.ForEachChild(visit)
	return found
}

// D311 reaches the experimental services (D313) in the editor too:
// completions after Experimental.Process. list the module's exports and the
// service's members, and hover and go to definition on
// Experimental.Process.hostname reach the service's declaration.
func TestEditorExperimentalServices(t *testing.T) {
	source := "export function host() {\n  return Experimental.Process.hostname()\n}\n"
	program, file, _, converters := editorProgram(t, source)
	service := ls.NewLanguageService(nil, program, fixHost{program: program, converters: converters}, file.FileName().AsString())
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s", d.String())
		}
	}
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	access := findNode(file.AsNode(), func(n *ast.Node) bool {
		return ast.IsPropertyAccessExpression(n) && n.Name().Text() == "hostname"
	})
	members := map[string]bool{}
	for _, symbol := range c.GetPropertiesOfType(serviceMemberCompletions(c, access.Expression(), c.GetTypeAtLocation(access.Expression()))) {
		members[symbol.Name()] = true
	}
	done()
	for _, name := range []string{"hostname", "pid", "isRunning", "kill", "layerTest"} {
		if !members[name] {
			t.Errorf("completions after Experimental.Process. lack %s", name)
		}
	}
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	if text := hoverText(t, service, uri, positionOf(source, "hostname", 1)); !strings.Contains(text, "hostname") {
		t.Errorf("hover on hostname = %q", text)
	}
	uris := definitionURIs(t, service, uri, positionOf(source, "hostname", 1))
	if len(uris) == 0 || !strings.HasSuffix(uris[0], "/experimental/Process.d.ts") {
		t.Errorf("definition of Experimental.Process.hostname = %v, want vibelang-runtime's experimental/Process.d.ts", uris)
	}
}

// Exercise the completion endpoint: namespace exports used to return before
// the member hook, even though the hook's direct tests passed.
func TestEditorModuleServiceCompletionEndpoint(t *testing.T) {
	for _, test := range []struct {
		name, access string
		want         []string
	}{
		{"effect", "FileSystem.", []string{"readFileString", "exists", "FileSystem", "make", "makeNoop"}},
		{"effect partial", "FileSystem.rea", []string{"readFileString"}},
		{"experimental", "Experimental.Process.", []string{"hostname", "pid", "Process", "make", "layerTest"}},
		{"experimental partial", "Experimental.Process.hos", []string{"hostname"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "export function read() { return " + test.access + " }\n"
			_, file, service, _ := editorProgram(t, source)
			result, err := service.ProvideCompletion(t.Context(), lsconv.FileNameToDocumentURI(file.FileName()),
				positionOf(source, test.access, len(test.access)), nil)
			if err != nil {
				t.Fatal(err)
			}
			if result.List == nil {
				t.Fatal("no completion list")
			}
			counts := map[string]int{}
			for _, item := range result.List.Items {
				counts[item.Label]++
			}
			for _, name := range test.want {
				if counts[name] != 1 {
					t.Errorf("completion %s occurs %d times, want once", name, counts[name])
				}
			}
		})
	}
}

// A namespace export and a service member can share a name. The completion
// must retain the namespace symbol, rather than an intersection of both.
func TestModuleServiceCompletionExportsWin(t *testing.T) {
	files := computedKeyFiles(false)
	effect := "/Users/x/src/node_modules/effect/"
	files[effect+"package.json"] = `{"name":"effect","type":"module","exports":{".":{"types":"./index.d.ts"},"./*":{"types":"./*.d.ts"}}}`
	files[effect+"FileSystem.d.ts"] = `export interface FileSystem { readonly make: () => number; readonly read: () => string }
export declare const FileSystem: { readonly "~effect/Context/Service": "~effect/Context/Service"; readonly Identifier: FileSystem; readonly Service: FileSystem };
export declare const make: (value: string) => FileSystem;`
	source := "import * as FileSystem from \"effect/FileSystem\"; export function f() { return FileSystem.make(\"x\") }"
	files["/Users/x/src/main.vibe"] = source
	program := computedKeyProgram(t, files)
	file := program.GetSourceFile("/Users/x/src/main.vibe")
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(program.GetSourceFile(name).Text())
	})
	service := ls.NewLanguageService(nil, program, fixHost{program: program, converters: converters}, file.FileName().AsString())
	result, err := service.GetCompletionsAtPosition(t.Context(), file, strings.Index(source, "FileSystem.make")+len("FileSystem."), nil, true)
	if err != nil || result == nil {
		t.Fatalf("completions: %v, %v", result, err)
	}
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	access := findNode(file.AsNode(), ast.IsPropertyAccessExpression)
	want := c.GetPropertyOfType(c.GetTypeAtLocation(access.Expression()), "make")
	if want == nil {
		t.Fatal("missing namespace export")
	}
	count := 0
	for _, item := range result.Items {
		if item.Label == "make" {
			count++
			if item.Symbol != want {
				t.Errorf("make completion symbol %v, want namespace export %v", item.Symbol, want)
			}
		}
	}
	if count != 1 {
		t.Errorf("make occurs %d times, want once", count)
	}
}

package compiler

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// Stock TypeScript maps a .ts importer's ./x.js and ./x only to x.ts, x.tsx
// or x.d.ts, never to the compatibility declaration x.d.vibe.ts. Each .vibe
// module therefore also gets x.d.ts, which re-exports its sidecar, so both
// spellings reach one module (VIP-27 Location: plain tsc understands .vibe
// imports).

func nativeDeclarationProject(t *testing.T, options map[string]any, vibe map[string]any, files map[string]any) (*Program, vfs.FS) {
	t.Helper()
	compilerOptions := map[string]any{"noLib": true, "module": "esnext", "moduleResolution": "bundler", "allowArbitraryExtensions": true, "noEmit": true}
	for key, value := range options {
		compilerOptions[key] = value
	}
	vibeOptions := map[string]any{"effectGlobals": false, "effectModules": false}
	for key, value := range vibe {
		vibeOptions[key] = value
	}
	config := map[string]any{"compilerOptions": compilerOptions, "vibe": vibeOptions, "include": []string{"src"}}
	if list, ok := files["files"]; ok {
		delete(config, "include")
		config["files"] = list
		delete(files, "files")
	}
	text, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	all := map[string]any{"/p/package.json": `{"type":"module"}`, "/p/tsconfig.json": string(text)}
	for name, content := range files {
		all[name] = content
	}
	fs := vfstest.FromMap(all, tspath.CaseSensitive)
	parsed, ds := tsoptions.GetParsedCommandLineOfConfigFile("/p/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(ds) != 0 || len(parsed.Errors) != 0 {
		t.Fatalf("configuration: %v %v", ds, parsed.Errors)
	}
	return NewProgram(ProgramOptions{Config: parsed, Host: NewCompilerHost(fs, "/", nil, nil, nil)}), fs
}

func emitNativeDeclarations(t *testing.T, p *Program, fs vfs.FS) *EmitResult {
	t.Helper()
	return p.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
		return fs.WriteFile(tspath.RootedFilePathFromNormalized(name), text)
	}, fs)
}

func readNative(fs vfs.FS, name string) (string, bool) {
	return fs.ReadFile(tspath.RootedFilePath(name))
}

func TestNativeDeclarationBesideSource(t *testing.T) {
	t.Parallel()
	p, fs := nativeDeclarationProject(t, nil, nil, map[string]any{
		"/p/src/x.vibe":      "export const answer: number = 42\nexport function twice(n: number) { return n * 2 }\n",
		"/p/src/d.vibe":      "const tag = \"d\"\nexport default tag\n",
		"/p/src/consumer.ts": "import { answer, twice } from \"./x.js\"\nimport tag from \"./d.js\"\nexport const doubled = twice(answer) + tag.length\n",
	})
	result := emitNativeDeclarations(t, p, fs)
	if result == nil || result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("emit: %+v", result)
	}
	if got, _ := readNative(fs, "/p/src/x.d.ts"); got != "export * from \"./x.vibe\";\n" {
		t.Fatalf("x.d.ts = %q", got)
	}
	if got, _ := readNative(fs, "/p/src/d.d.ts"); got != "export * from \"./d.vibe\";\nexport { default } from \"./d.vibe\";\n" {
		t.Fatalf("d.d.ts = %q", got)
	}
	if _, ok := readNative(fs, "/p/src/consumer.d.ts"); ok {
		t.Fatal("a .ts file got a native declaration")
	}
}

func TestNativeDeclarationVibexForJsx(t *testing.T) {
	t.Parallel()
	p, fs := nativeDeclarationProject(t, map[string]any{"jsx": "preserve"}, nil, map[string]any{
		"/p/src/App.vibex": "export const title: string = \"app\"\n",
	})
	if result := emitNativeDeclarations(t, p, fs); result == nil || len(result.Diagnostics) != 0 {
		t.Fatalf("emit: %+v", result)
	}
	if got, _ := readNative(fs, "/p/src/App.d.ts"); got != "export * from \"./App.vibex\";\n" {
		t.Fatalf("App.d.ts = %q", got)
	}
}

// A hand-written declaration at the path is never overwritten: the build
// reports TS5055 for it and names the module it would have represented.
func TestNativeDeclarationKeepsHandWrittenDeclaration(t *testing.T) {
	t.Parallel()
	const authored = "export declare const answer: 41;\n"
	p, fs := nativeDeclarationProject(t, nil, nil, map[string]any{
		"/p/src/x.vibe": "export const answer: number = 42\n",
		"/p/src/x.d.ts": authored,
	})
	result := emitNativeDeclarations(t, p, fs)
	if got, _ := readNative(fs, "/p/src/x.d.ts"); got != authored {
		t.Fatalf("hand-written x.d.ts was rewritten: %q", got)
	}
	if result == nil || !result.EmitSkipped {
		t.Fatalf("emit was not skipped: %+v", result)
	}
	var found bool
	for _, d := range result.Diagnostics {
		if d.Code() == diagnostics.Cannot_write_file_0_because_it_would_overwrite_input_file.Code() {
			text := flatDiagnostic(d)
			found = strings.Contains(text, "/p/src/x.d.ts") && strings.Contains(text, "/p/src/x.vibe")
		}
	}
	if !found {
		t.Fatalf("want TS5055 naming x.d.ts and x.vibe, got %v", diagnosticStrings(result.Diagnostics))
	}
	if _, ok := readNative(fs, "/p/src/x.d.vibe.ts"); !ok {
		t.Fatal("the compatibility sidecar was not written")
	}
}

// The project's own declaration output owns x.d.ts when it is written beside
// the source.
func TestNativeDeclarationYieldsToDeclarationOutput(t *testing.T) {
	t.Parallel()
	p, fs := nativeDeclarationProject(t, map[string]any{"noEmit": false, "declaration": true, "emitDeclarationOnly": true}, nil, map[string]any{
		"/p/src/x.vibe": "export const answer: number = 42\n",
	})
	var written []string
	result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
		written = append(written, name)
		return fs.WriteFile(tspath.RootedFilePathFromNormalized(name), text)
	}, fs)
	if result == nil || len(result.Diagnostics) != 0 {
		t.Fatalf("emit: %+v", result)
	}
	if slices.Contains(written, "/p/src/x.d.ts") {
		t.Fatalf("compatibility emit wrote the project's declaration output: %v", written)
	}
	if ds := p.GetProgramDiagnostics(); len(ds) != 0 {
		t.Fatalf("program: %v", diagnosticStrings(ds))
	}
}

// Discovery treats x.d.ts as an emit output, as it treats x.d.vibe.ts.
func TestNativeDeclarationLeftOutOfDiscovery(t *testing.T) {
	t.Parallel()
	for _, layout := range []string{"beside", "sidecarDir"} {
		t.Run(layout, func(t *testing.T) {
			t.Parallel()
			options := map[string]any{}
			vibe := map[string]any{}
			files := map[string]any{
				"/p/src/x.vibe":      "export const answer: number = 42\n",
				"/p/src/y.vibex":     "export const title: string = \"y\"\n",
				"/p/src/native.d.ts": "export declare const native: number;\n",
			}
			declarations := "/p/src/"
			if layout == "sidecarDir" {
				options = map[string]any{"rootDir": ".", "rootDirs": []string{".", ".vibe/declarations"}}
				vibe = map[string]any{"sidecarDir": ".vibe/declarations"}
				declarations = "/p/.vibe/declarations/src/"
			}
			files[declarations+"x.d.ts"] = "export * from \"./x.vibe\";\n"
			files[declarations+"x.d.vibe.ts"] = "export declare const answer: number;\n"
			files[declarations+"y.d.ts"] = "export * from \"./y.vibex\";\n"
			options["jsx"] = "preserve"
			compilerOptions := map[string]any{"noLib": true, "module": "esnext", "moduleResolution": "bundler", "allowArbitraryExtensions": true, "noEmit": true}
			for key, value := range options {
				compilerOptions[key] = value
			}
			vibeOptions := map[string]any{"effectGlobals": false, "effectModules": false}
			for key, value := range vibe {
				vibeOptions[key] = value
			}
			// A glob skips dot directories, so the relocated layout names its
			// directory explicitly.
			include := []string{"**/*"}
			if layout == "sidecarDir" {
				include = []string{"src", ".vibe/declarations"}
			}
			text, _ := json.Marshal(map[string]any{"compilerOptions": compilerOptions, "vibe": vibeOptions, "include": include})
			files["/p/tsconfig.json"] = string(text)
			files["/p/package.json"] = `{"type":"module"}`
			fs := vfstest.FromMap(files, tspath.CaseSensitive)
			parsed, ds := tsoptions.GetParsedCommandLineOfConfigFile("/p/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(ds) != 0 || len(parsed.Errors) != 0 {
				t.Fatalf("configuration: %v %v", ds, parsed.Errors)
			}
			var names []string
			for _, name := range parsed.FileNames() {
				names = append(names, string(name))
			}
			slices.Sort(names)
			want := []string{"/p/src/native.d.ts", "/p/src/x.vibe", "/p/src/y.vibex"}
			if !slices.Equal(names, want) {
				t.Fatalf("discovered %v, want %v", names, want)
			}
		})
	}
}

// An explicitly listed declaration stays an input, as for x.d.vibe.ts.
func TestNativeDeclarationExplicitInputReportsTS5055(t *testing.T) {
	t.Parallel()
	p, _ := nativeDeclarationProject(t, nil, nil, map[string]any{
		"files":         []string{"src/x.vibe", "src/x.d.ts"},
		"/p/src/x.vibe": "export const answer: number = 42\n",
		"/p/src/x.d.ts": "export declare const answer: number;\n",
	})
	var found bool
	for _, d := range p.GetProgramDiagnostics() {
		if d.Code() == diagnostics.Cannot_write_file_0_because_it_would_overwrite_input_file.Code() && strings.Contains(flatDiagnostic(d), "/p/src/x.d.ts") {
			found = true
		}
	}
	if !found {
		t.Fatalf("want TS5055 for the listed x.d.ts, got %v", diagnosticStrings(p.GetProgramDiagnostics()))
	}
}

// flatDiagnostic is a diagnostic's message with its chain.
func flatDiagnostic(d *ast.Diagnostic) string {
	text := d.String()
	for _, chained := range d.MessageChain() {
		text += "\n  " + flatDiagnostic(chained)
	}
	return text
}

func diagnosticStrings(ds []*ast.Diagnostic) []string {
	var out []string
	for _, d := range ds {
		out = append(out, flatDiagnostic(d))
	}
	return out
}

func TestNativeDeclarationTextForms(t *testing.T) {
	t.Parallel()
	for _, test := range []struct{ name, sidecar, want string }{
		{"named", "export declare const a: number;\n", "export * from \"./x.vibe\";\n"},
		{"types and namespaces", "export type T = 1;\nexport interface I {}\nexport declare namespace N { const n: 1 }\nexport * as other from \"./o.vibe\";\n", "export * from \"./x.vibe\";\n"},
		{"export default", "declare const _default: 1;\nexport default _default;\n", "export * from \"./x.vibe\";\nexport { default } from \"./x.vibe\";\n"},
		{"default modifier", "export default function f(): void;\n", "export * from \"./x.vibe\";\nexport { default } from \"./x.vibe\";\n"},
		{"named default", "declare const a: 1;\nexport { a as default };\n", "export * from \"./x.vibe\";\nexport { default } from \"./x.vibe\";\n"},
		{"export =", "declare const a: { b: 1 };\nexport = a;\n", "import vibe = require(\"./x.vibe\");\nexport = vibe;\n"},
		{"global augmentation stays in the sidecar", "export {};\ndeclare global {\n    const vibeMark: number;\n}\n", "export * from \"./x.vibe\";\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got := NativeDeclarationText("./x.vibe", test.sidecar)
			if got != test.want {
				t.Fatalf("NativeDeclarationText = %q, want %q", got, test.want)
			}
			if !isNativeDeclarationText(got, "./x.vibe") {
				t.Fatalf("%q is not recognized as its own output", got)
			}
			if isNativeDeclarationText(got, "./y.vibe") {
				t.Fatalf("%q is recognized for another module", got)
			}
		})
	}
	for _, foreign := range []string{
		"export declare const a: number;\n",
		"export * from \"./x.vibe\";\nexport declare const extra: 1;\n",
		"export { a } from \"./x.vibe\";\n",
		"export type * from \"./x.vibe\";\n",
		"",
	} {
		if isNativeDeclarationText(foreign, "./x.vibe") {
			t.Fatalf("hand-written %q is recognized as emit output", foreign)
		}
	}
}

// A written ./x.ts keeps native substitutions, including x.d.ts, but never
// falls back to VibeLang source (chapter 7). Before the first build it is
// TS2307; afterwards it reaches the native declaration, as in stock tsc, and
// through it the module. The .ts spelling still needs
// allowImportingTsExtensions (TS5097).
func TestNativeDeclarationIsTheNativeCandidateOfWrittenTs(t *testing.T) {
	t.Parallel()
	for _, layout := range []string{"beside", "sidecarDir"} {
		for _, allow := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s/allowImportingTsExtensions=%t", layout, allow), func(t *testing.T) {
				t.Parallel()
				native, sidecar := "/p/src/x.d.ts", "/p/src/x.d.vibe.ts"
				var vibe map[string]any
				files := map[string]any{
					"/p/src/x.vibe":      "export const answer: number = 42\n",
					"/p/src/consumer.ts": "import { answer } from \"./x.ts\"\nexport const doubled: number = answer * 2\n",
				}
				codes := func(p *Program) []int32 {
					var codes []int32
					consumer := p.GetSourceFile("/p/src/consumer.ts")
					for _, d := range p.GetSemanticDiagnostics(t.Context(), consumer) {
						codes = append(codes, d.Code())
					}
					return codes
				}
				options := map[string]any{"allowImportingTsExtensions": allow}
				if layout == "sidecarDir" {
					options["rootDir"] = "."
					options["rootDirs"] = []string{".", ".vibe/declarations"}
					vibe = map[string]any{"sidecarDir": ".vibe/declarations"}
					native, sidecar = "/p/.vibe/declarations/src/x.d.ts", "/p/.vibe/declarations/src/x.d.vibe.ts"
				}
				p, fs := nativeDeclarationProject(t, options, vibe, files)
				if got := codes(p); !slices.Equal(got, []int32{2307}) {
					t.Fatalf("before the first build: %v, want [2307]", got)
				}
				if result := emitNativeDeclarations(t, p, fs); result == nil || len(result.Diagnostics) != 0 {
					t.Fatalf("emit: %+v", result)
				}
				files[native], _ = readNative(fs, native)
				files[sidecar], _ = readNative(fs, sidecar)
				p, _ = nativeDeclarationProject(t, options, vibe, files)
				var want []int32
				if !allow {
					want = []int32{5097}
				}
				if got := codes(p); !slices.Equal(got, want) {
					t.Fatalf("after the first build: %v, want %v", got, want)
				}
				consumer := p.GetSourceFile("/p/src/consumer.ts")
				if resolved := p.GetResolvedModuleFromModuleSpecifier(consumer, consumer.Imports()[0]); string(resolved.ResolvedFileName) != native {
					t.Fatalf("./x.ts resolved to %q, want the native declaration", resolved.ResolvedFileName)
				}
				if ds := p.GetProgramDiagnostics(); len(ds) != 0 {
					t.Fatalf("the resolved native declaration is not an input to protect: %v", diagnosticStrings(ds))
				}
				// Its re-export reaches the module's source, never the sidecar.
				if p.GetSourceFile(tspath.RootedFilePath(sidecar)) != nil || p.GetSourceFile("/p/src/x.vibe") == nil {
					t.Fatalf("the native declaration's ./x.vibe did not reach the source")
				}
			})
		}
	}
}

// reconfigure writes the project's config and files into an existing file
// system, as a user edits a project between builds, and loads it again.
func reconfigure(t *testing.T, fs vfs.FS, options map[string]any, vibe map[string]any, files map[string]any) *Program {
	t.Helper()
	compilerOptions := map[string]any{"noLib": true, "module": "esnext", "moduleResolution": "bundler", "allowArbitraryExtensions": true, "noEmit": true, "jsx": "preserve"}
	for key, value := range options {
		compilerOptions[key] = value
	}
	vibeOptions := map[string]any{"effectGlobals": false, "effectModules": false}
	for key, value := range vibe {
		vibeOptions[key] = value
	}
	config := map[string]any{"compilerOptions": compilerOptions, "vibe": vibeOptions, "include": []string{"src"}}
	if list, ok := files["files"]; ok {
		delete(config, "include")
		config["files"] = list
	}
	text, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	all := map[string]any{"/p/package.json": `{"type":"module"}`, "/p/tsconfig.json": string(text)}
	for name, content := range files {
		if name != "files" {
			all[name] = content
		}
	}
	for name, content := range all {
		if err := fs.WriteFile(tspath.RootedFilePath(name), content.(string)); err != nil {
			t.Fatal(err)
		}
	}
	parsed, ds := tsoptions.GetParsedCommandLineOfConfigFile("/p/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(ds) != 0 || len(parsed.Errors) != 0 {
		t.Fatalf("configuration: %v %v", ds, parsed.Errors)
	}
	return NewProgram(ProgramOptions{Config: parsed, Host: NewCompilerHost(fs, "/", nil, nil, nil)})
}

func emitCleanly(t *testing.T, p *Program, fs vfs.FS) {
	t.Helper()
	if result := emitNativeDeclarations(t, p, fs); result == nil || result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("emit: %+v", result)
	}
}

// Switching vibe.sidecarDir on or off moves the native declaration with its
// sidecar, and removes the copy the previous build wrote.
func TestNativeDeclarationFollowsLayoutSwitch(t *testing.T) {
	t.Parallel()
	beside := map[string]any{"rootDir": "."}
	relocated := map[string]any{"rootDir": ".", "rootDirs": []string{".", ".vibe/declarations"}}
	directory := map[string]any{"sidecarDir": ".vibe/declarations"}
	const want = "export * from \"./x.vibe\";\n"
	for _, on := range []bool{true, false} {
		t.Run(fmt.Sprintf("sidecarDir on=%t", on), func(t *testing.T) {
			t.Parallel()
			files := map[string]any{"/p/src/x.vibe": "export const answer: number = 42\n"}
			fs := vfstest.FromMap(map[string]any{}, tspath.CaseSensitive)
			from, to := "/p/src/x.d.ts", "/p/.vibe/declarations/src/x.d.ts"
			first, firstVibe, second, secondVibe := beside, map[string]any(nil), relocated, directory
			if !on {
				from, to = to, from
				first, firstVibe, second, secondVibe = relocated, directory, beside, nil
			}
			emitCleanly(t, reconfigure(t, fs, first, firstVibe, files), fs)
			if got, _ := readNative(fs, from); got != want {
				t.Fatalf("first build: %s = %q", from, got)
			}
			emitCleanly(t, reconfigure(t, fs, second, secondVibe, files), fs)
			if got, _ := readNative(fs, to); got != want {
				t.Fatalf("after the switch: %s = %q", to, got)
			}
			if _, ok := readNative(fs, from); ok {
				t.Fatalf("after the switch the old %s remains", from)
			}
		})
	}
}

// A native declaration another project wrote, at the place this project's
// other layout uses, is not this project's to prune.
func TestNativeDeclarationKeepsAnotherProjectsCopy(t *testing.T) {
	t.Parallel()
	fs := vfstest.FromMap(map[string]any{
		"/p/src/x.vibe": "export const answer: number = 42\n",
		"/p/src/x.d.ts": "export * from \"./x.vibe\";\n",
	}, tspath.CaseSensitive)
	emitCleanly(t, reconfigure(t, fs, map[string]any{"rootDir": ".", "rootDirs": []string{".", ".vibe/declarations"}}, map[string]any{"sidecarDir": ".vibe/declarations"}, map[string]any{}), fs)
	if _, ok := readNative(fs, "/p/src/x.d.ts"); !ok {
		t.Fatal("a native declaration this project did not write was pruned")
	}
}

// Beside x.ts or x.tsx, ./x.js already reaches the TypeScript module under
// both checkers, so the module gets no native declaration, and the one an
// earlier build wrote is removed.
func TestNativeDeclarationYieldsToTypeScriptSibling(t *testing.T) {
	t.Parallel()
	for _, sibling := range []string{"src/x.ts", "src/x.tsx"} {
		t.Run(sibling, func(t *testing.T) {
			t.Parallel()
			fs := vfstest.FromMap(map[string]any{}, tspath.CaseSensitive)
			files := map[string]any{"/p/src/x.vibe": "export const answer: number = 42\n"}
			emitCleanly(t, reconfigure(t, fs, nil, nil, files), fs)
			if _, ok := readNative(fs, "/p/src/x.d.ts"); !ok {
				t.Fatal("first build wrote no x.d.ts")
			}
			// Discovery prefers the sibling, so both are listed.
			files["/p/"+sibling] = "export const answer: string = \"native\"\n"
			files["files"] = []string{"src/x.vibe", sibling}
			emitCleanly(t, reconfigure(t, fs, nil, nil, files), fs)
			if _, ok := readNative(fs, "/p/src/x.d.ts"); ok {
				t.Fatal("x.d.ts kept beside a TypeScript sibling")
			}
		})
	}
}

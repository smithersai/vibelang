package compiler_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// VIP-40 slice 5: the compatibility sidecar's re-export must resolve without
// loading the source or the compiler's virtual files.
func TestModuleDeclarationSidecars(t *testing.T) {
	for _, layout := range []string{"", "types"} {
		for _, noEmit := range []bool{false, true} {
			t.Run(fmt.Sprintf("layout=%s/noEmit=%t", layout, noEmit), func(t *testing.T) {
				files := map[string]any{
					"/src/package.json":  `{"type":"module"}`,
					"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","declaration":true,"outDir":"out","noEmit":%t},"vibe":{"effectGlobals":false,"effectModules":false,"sidecarDir":%q},"files":["main.vibe"]}`, noEmit, layout),
					"/src/main.vibe":     "module parse {\n  /** @throws {RangeError} */\n  export function port(raw: string): number { return Number(raw) }\n}\nexport { port } from parse\n",
				}
				fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
				config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
				if len(ds) != 0 {
					t.Fatal(ds)
				}
				p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
				emitted := map[string]string{}
				result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { emitted[name] = text; return nil })
				if result == nil || result.EmitSkipped || len(result.Diagnostics) != 0 {
					t.Fatalf("sidecar emit: %+v", result)
				}
				dir := "/src/"
				if layout != "" {
					dir += layout + "/"
				}
				main := emitted[dir+"main.d.vibe.ts"]
				body := emitted["/src/main.vibe.parse.d.ts"]
				specifier := "./main.vibe.parse.js"
				if layout != "" {
					specifier = "../main.vibe.parse.js"
				}
				if !strings.Contains(main, fmt.Sprintf("%q", specifier)) {
					t.Fatalf("missing re-export: %q (%v)", main, emitted)
				}
				if !strings.Contains(body, "@throws {RangeError}") || !strings.Contains(body, "port(raw: string): number") {
					t.Fatalf("body declaration missing type or JSDoc: %q (%v)", body, emitted)
				}
			})
		}
	}
}

// A generated body declaration must neither overwrite a listed input nor
// conflict with its own ordinary declaration output when outDir is absent. That
// ordinary output owns the path, so the sidecar pass leaves it to ordinary emit.
func TestModuleDeclarationSidecarOutputPaths(t *testing.T) {
	for _, explicit := range []bool{false, true} {
		for _, declaration := range []bool{false, true} {
			t.Run(fmt.Sprintf("explicit=%t/declaration=%t", explicit, declaration), func(t *testing.T) {
				names := `"main.vibe"`
				if explicit {
					names += `,"main.vibe.parse.d.ts"`
				}
				files := map[string]any{
					"/src/package.json":  `{"type":"module"}`,
					"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","declaration":%t},"vibe":{"effectGlobals":false,"effectModules":false},"files":[%s]}`, declaration, names),
					"/src/main.vibe":     "module parse { export const n = 1 }\nexport { n } from parse\n",
				}
				if explicit {
					files["/src/main.vibe.parse.d.ts"] = "export declare const handwritten: unique symbol\n"
				}
				fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
				config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
				if len(ds) != 0 {
					t.Fatal(ds)
				}
				p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
				blocked := false
				for _, d := range p.GetProgramDiagnostics() {
					if d.Code() == 5055 {
						blocked = true
					}
					if d.Code() == 5056 {
						t.Fatalf("body conflicts with its own declaration: %s", d.String())
					}
				}
				if blocked != explicit {
					t.Fatalf("overwrite diagnostic=%t, explicit input=%t", blocked, explicit)
				}
				written := false
				result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
					if name == "/src/main.vibe.parse.d.ts" {
						written = true
					}
					return nil
				})
				if want := !explicit && !declaration; written != want {
					t.Fatalf("body written=%t, want %t", written, want)
				}
				if result == nil || result.EmitSkipped != explicit {
					t.Fatalf("result=%+v", result)
				}
			})
		}
	}
}

// A sidecar that names a body written by another file, through an inferred
// type, reaches that body's declaration too.
func TestModuleDeclarationSidecarOtherFileBody(t *testing.T) {
	files := map[string]any{
		"/src/package.json":  `{"type":"module"}`,
		"/src/tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","noEmit":true},"vibe":{"effectGlobals":false,"effectModules":false},"files":["main.vibe"]}`,
		"/src/main.vibe":     "import { make } from \"./other.vibe\"\nexport const made = make()\n",
		"/src/other.vibe":    "module shapes { export interface Shape { readonly side: number }\n export function shape(): Shape { return { side: 1 } } }\nimport { shape } from shapes\nexport function make() { return shape() }\n",
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
	config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(ds) != 0 {
		t.Fatal(ds)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	emitted := map[string]string{}
	if result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { emitted[name] = text; return nil }); result == nil || len(result.Diagnostics) != 0 {
		t.Fatalf("sidecar emit: %+v", result)
	}
	if !strings.Contains(emitted["/src/other.vibe.shapes.d.ts"], "readonly side: number") {
		t.Fatalf("missing referenced body declaration: %v", emitted)
	}
}

// Discovering a previous body declaration must not turn it into an input of
// its own next build. A similarly named declaration with no matching body
// remains an ordinary input, and explicit files are never filtered.
func TestModuleDeclarationSidecarDiscovery(t *testing.T) {
	for _, name := range []string{"parse", "Text", "Ω"} {
		for _, explicit := range []bool{false, true} {
			for _, declared := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/explicit=%t/declared=%t", name, explicit, declared), func(t *testing.T) {
					child := "/src/main.vibe" + strings.TrimSuffix(parser.ModuleDeclarationFileSuffix(name), ".ts") + ".d.ts"
					body := "export const n = 1\n"
					if declared {
						body = "module " + name + " { export const n = 1 }\nexport { n } from " + name + "\n"
					}
					selection := `"include":["*"]`
					if explicit {
						selection = fmt.Sprintf(`"files":["main.vibe",%q]`, strings.TrimPrefix(child, "/src/"))
					}
					fs := vfstest.FromMap(map[string]any{
						"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"noLib":true},%s}`, selection),
						"/src/main.vibe":     body,
						child:                "export declare const n: number\n",
					}, tspath.CaseSensitive)
					config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
					if len(ds) != 0 {
						t.Fatal(ds)
					}
					found := false
					for _, file := range config.FileNames() {
						if string(file) == child {
							found = true
						}
					}
					if found != (explicit || !declared) {
						t.Fatalf("child input=%t, explicit=%t, declared=%t: %v", found, explicit, declared, config.FileNames())
					}
				})
			}
		}
	}
}

// A project under a hidden directory: the last dot of /work/.hidden/proj/env is in
// a directory's name, so env.d.ts is the project's own file.
func TestModuleDeclarationDiscoveryUnderHiddenDirectory(t *testing.T) {
	names := projectFileNames(t, "/work/.hidden/proj", `["*"]`, nil)
	if !slices.Contains(names, "env.d.ts") {
		t.Fatalf("env.d.ts not in %v", names)
	}
}

// A declaration whose name starts with a dot is the project's own file, as tsc
// selects it: the text before its last dot (/p/ for .env.d.ts and ..d.ts, /p/.
// for ...d.ts) is no source path. Each panicked before, through a wildcard
// that matches dotfiles or a pattern that names the file.
func TestModuleDeclarationDiscoveryDotPrefixedNames(t *testing.T) {
	for _, name := range []string{".env.d.ts", "..d.ts", "...d.ts", ".d.ts", ".x.vibe.d.ts", ".vibe.d.ts"} {
		for _, include := range []string{`["*", ".*"]`, fmt.Sprintf(`["main.vibe", %q]`, name)} {
			t.Run(name+" "+include, func(t *testing.T) {
				names := projectFileNames(t, "/work/proj", include, map[string]string{name: "declare const dotValue: string\n"})
				if !slices.Contains(names, name) {
					t.Fatalf("%s not in %v", name, names)
				}
			})
		}
	}
}

// projectFileNames parses the project at dir with the include patterns and
// extra files and lists its input files relative to dir, sorted. A panic
// fails the caller.
func projectFileNames(t *testing.T, dir string, include string, extra map[string]string) []string {
	t.Helper()
	files := map[string]any{
		dir + "/tsconfig.json":        `{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","types":[],"noEmit":true},"include":` + include + `}`,
		dir + "/main.vibe":            "export const a = 1\n",
		dir + "/index.ts":             "export const b = 2\n",
		dir + "/env.d.ts":             "declare const envValue: string\n",
		dir + "/env.local.d.ts":       "declare const localValue: string\n",
		dir + "/main.vibe.parse.d.ts": "declare const parseValue: string\n",
	}
	for name, text := range extra {
		files[dir+"/"+name] = text
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
	config, ds := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromNormalized(dir+"/tsconfig.json"), &core.CompilerOptions{}, nil, fs, nil)
	if len(ds) != 0 {
		t.Fatalf("%s: %v", dir, ds)
	}
	var names []string
	for _, name := range config.FileNames() {
		names = append(names, strings.TrimPrefix(name.AsString(), dir+"/"))
	}
	slices.Sort(names)
	return names
}

// sanitizeSegment keeps the characters a path segment may hold in this test.
func sanitizeSegment(segment string) string {
	return strings.Map(func(r rune) rune {
		if r == '.' || r == '-' || r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			return r
		}
		return '_'
	}, segment)
}

// Property: a project parses the same wherever it sits, and a declaration
// whose name starts with a dot is its own input. Directories above it may be
// hidden (.x), dotted (a.b) or end in .vibe; tsc reads their names as names, so
// the input files match those of the same project at /work/plain/proj.
// main.vibe declares no module, so main.vibe.parse.d.ts and every <name>.d.ts
// are the project's own files in both places.
func FuzzModuleDeclarationDiscoveryUnderDottedDirectories(f *testing.F) {
	for _, seed := range [][2]string{
		{".hidden", ".env"}, {"a.b/.c", "."}, {"x.vibe", ".."}, {"x.vibe.d", ".x.vibe"}, {".vibe", ".vibe"},
		{"..x/.y.z", "...."}, {"a.vibe.b/c", ".a.b.c"}, {".a/.b/.c/.d", ".main.vibe.parse"}, {"main.vibe", ".env.local"},
	} {
		f.Add(seed[0], seed[1])
	}
	f.Fuzz(func(t *testing.T, path string, stem string) {
		var segments []string
		for _, segment := range strings.Split(path, "/") {
			segment = sanitizeSegment(segment)
			if segment != "" && segment != "." && segment != ".." && len(segments) < 4 {
				segments = append(segments, segment)
			}
		}
		if len(segments) == 0 {
			t.Skip()
		}
		// A dot-prefixed name collides with no other file of the project.
		name := "." + strings.TrimPrefix(sanitizeSegment(stem), ".")
		if len(name) > 40 {
			name = name[:40]
		}
		name += tspath.ExtensionDts
		extra := map[string]string{name: "declare const dotValue: string\n"}
		plain := projectFileNames(t, "/work/plain/proj", `["*", ".*"]`, extra)
		for _, want := range []string{"env.d.ts", "main.vibe.parse.d.ts", name} {
			if !slices.Contains(plain, want) {
				t.Fatalf("%s not at /work/plain/proj: %v", want, plain)
			}
		}
		dir := "/work/" + strings.Join(segments, "/") + "/proj"
		if got := projectFileNames(t, dir, `["*", ".*"]`, extra); !slices.Equal(got, plain) {
			t.Fatalf("%s: %v, at /work/plain/proj: %v", dir, got, plain)
		}
	})
}

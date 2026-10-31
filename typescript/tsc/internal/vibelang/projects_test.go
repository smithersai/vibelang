package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// projectFiles is a workspace in which /app imports the .vibe source of the
// workspace package /producer, and both call key() from the plain TypeScript
// package @acme/helper.
func projectFiles(producerTrust, appTrust string) map[string]string {
	return fixtureRuntime(map[string]string{
		"/node_modules/@acme/helper/package.json": `{"name":"@acme/helper","types":"index.d.ts"}`,
		"/node_modules/@acme/helper/index.d.ts":   `export declare function key(): number`,
		"/producer/package.json":                  `{"name":"@acme/producer"}`,
		"/producer/tsconfig.json":                 fmt.Sprintf(`{"compilerOptions":{"strict":true,"noEmit":true,"allowImportingTsExtensions":true},"vibelang":{"trustedPackages":%s},"include":["src"]}`, producerTrust),
		"/producer/src/lib.vibe":                  `import { key } from "@acme/helper"` + "\n" + `export function produce() { return key() }`,
		"/app/package.json":                       `{"name":"app"}`,
		"/app/main.vibe":                          `import { key } from "@acme/helper"` + "\n" + `import { produce } from "../producer/src/lib.vibe"` + "\n" + `export function use() { return produce() + key() }`,
		"/app/tsconfig.json":                      fmt.Sprintf(`{"compilerOptions":{"strict":true,"noEmit":true,"allowImportingTsExtensions":true},"vibelang":{"trustedPackages":%s},"files":["main.vibe"]}`, appTrust),
	})
}

// untrustedCalls compiles config in files and returns the EK4401 count in
// each named file, failing the test on any other error.
func untrustedCalls(t *testing.T, files map[string]string, config tspath.RootedFilePath, names ...tspath.RootedFilePath) []int {
	t.Helper()
	fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(files), tspath.CaseSensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(config, &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(parsed.Errors) != 0 {
		t.Fatalf("config: %v / %v", errors, parsed.Errors)
	}
	return untrustedCallsIn(t, fs, parsed, names...)
}

// untrustedCallsIn compiles the parsed command line over fs and returns the
// EK4401 count in each named file, failing the test on any other error.
func untrustedCallsIn(t *testing.T, fs vfs.FS, parsed *tsoptions.ParsedCommandLine, names ...tspath.RootedFilePath) []int {
	t.Helper()
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	counts := make([]int, len(names))
	for i, name := range names {
		file := p.GetSourceFile(name)
		if file == nil {
			t.Fatalf("%s is not in the program", name)
		}
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == EK4401.Code {
				counts[i]++
			} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
				t.Errorf("unexpected diagnostic in %s: %v", name, d)
			}
		}
	}
	return counts
}

// D297: the package that owns a .vibe file decides what its calls trust, in
// every program that reads it; the compiled project's settings keep applying
// to its own files.
func TestForeignVibeFileUsesItsOwnProjectSettings(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name                    string
		producerTrust, appTrust string
		foreign, own            int
	}{
		{"only the producer trusts the helper", `["@acme/helper"]`, `[]`, 0, 1},
		{"only the app trusts the helper", `[]`, `["@acme/helper"]`, 1, 0},
		{"both trust it", `["@acme/*"]`, `["@acme/helper"]`, 0, 0},
		{"neither trusts it", `[]`, `[]`, 1, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			counts := untrustedCalls(t, projectFiles(test.producerTrust, test.appTrust), "/app/tsconfig.json", "/producer/src/lib.vibe", "/app/main.vibe")
			if counts[0] != test.foreign || counts[1] != test.own {
				t.Fatalf("EK4401 in the producer, the app = %d, %d; want %d, %d", counts[0], counts[1], test.foreign, test.own)
			}
		})
	}
}

// D297: a program without a tsconfig, such as `vibelang --ignoreConfig a.ts`
// or a command line of files, has no VibeLang settings of its own, so each
// package's .vibe file keeps its package's settings there too, the same ones
// its own build checks it with.
func TestCommandLineProgramUsesEachPackageProjectSettings(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name          string
		producerTrust string
		appTrust      string
		foreign, own  int
	}{
		{"the producer's trust holds", `["@acme/helper"]`, `[]`, 0, 1},
		{"the producer's distrust holds", `[]`, `["@acme/helper"]`, 1, 0},
		{"neither trusts it", `[]`, `[]`, 1, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			fs := bundled.WrapFS(vfstest.FromMap(projectFiles(test.producerTrust, test.appTrust), tspath.CaseSensitive))
			parsed := tsoptions.ParseCommandLine([]string{"--strict", "--noEmit", "--allowImportingTsExtensions", "/app/main.vibe"}, fs, "/")
			if len(parsed.Errors) != 0 {
				t.Fatalf("command line: %v", parsed.Errors)
			}
			counts := untrustedCallsIn(t, fs, parsed, "/producer/src/lib.vibe", "/app/main.vibe")
			if counts[0] != test.foreign || counts[1] != test.own {
				t.Fatalf("EK4401 in the producer, the app = %d, %d; want %d, %d", counts[0], counts[1], test.foreign, test.own)
			}
		})
	}
}

// D297: the producer's own build reports what the app's build reports for the
// producer's file, so the two programs agree.
func TestForeignVibeFileMatchesItsOwnBuild(t *testing.T) {
	t.Parallel()
	for _, trust := range []string{`["@acme/helper"]`, `[]`} {
		files := projectFiles(trust, `[]`)
		own := untrustedCalls(t, files, "/producer/tsconfig.json", "/producer/src/lib.vibe")
		read := untrustedCalls(t, files, "/app/tsconfig.json", "/producer/src/lib.vibe")
		if own[0] != read[0] {
			t.Fatalf("trust %s: the producer's build reports %d EK4401, the app's build %d", trust, own[0], read[0])
		}
	}
}

// D297: a second tsconfig of the same package, such as a test tsconfig that
// extends the package's, applies its own settings to the package's files.
func TestSamePackageKeepsTheCompiledProjectSettings(t *testing.T) {
	t.Parallel()
	files := projectFiles(`[]`, `[]`)
	files["/producer/tsconfig.test.json"] = `{"extends":"./tsconfig.json","vibelang":{"trustedPackages":["@acme/helper"]}}`
	if counts := untrustedCalls(t, files, "/producer/tsconfig.test.json", "/producer/src/lib.vibe"); counts[0] != 0 {
		t.Fatalf("EK4401 under the test tsconfig = %d, want 0", counts[0])
	}
	if counts := untrustedCalls(t, files, "/producer/tsconfig.json", "/producer/src/lib.vibe"); counts[0] != 1 {
		t.Fatalf("EK4401 under the package tsconfig = %d, want 1", counts[0])
	}
}

// D297: a workspace package linked into node_modules, as pnpm links one, keeps
// its own package's settings in a program that imports it by name, whether its
// tsconfig sets them at the top level or in compilerOptions. A package with no
// tsconfig.json above its files takes the importing project's.
func TestLinkedWorkspaceVibeFileUsesItsOwnProjectSettings(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name     string
		project  string // the workspace package's tsconfig.json, or "" for none
		importer string // the importing project's VibeLang settings
		want     int    // EK4401 reports in the workspace package's .vibe file
	}{
		{"the package's own trust holds", `{"compilerOptions":{"strict":true},"vibelang":{"trustedPackages":["@smthrs/*"]}}`, `{}`, 0},
		{"compilerOptions.vibelang holds too", `{"compilerOptions":{"strict":true,"vibelang":{"trustedPackages":["@smthrs/*"]}}}`, `{}`, 0},
		{"the importer's trust does not reach it", `{"compilerOptions":{"strict":true}}`, `{"trustedPackages":["@smthrs/*"]}`, 1},
		{"a package without a project takes the importer's", ``, `{"trustedPackages":["@smthrs/*"]}`, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			files := map[string]any{
				"/workspace/errors/package.json":   `{"name":"@smthrs/errors","type":"module","exports":{".":"./src/index.ts"}}`,
				"/workspace/errors/src/Code.ts":    `export function isCode(value: string): boolean { return value === "a" }`,
				"/workspace/errors/src/Check.vibe": "import { isCode } from \"./Code.ts\"\nexport function check(value: string) {\n  return isCode(value)\n}\n",
				"/workspace/errors/src/index.ts":   `export { check } from "./Check.vibe"`,
				"/app/node_modules/@smthrs/errors": vfstest.Symlink("/workspace/errors"),
				"/app/package.json":                `{"name":"app","type":"module"}`,
				"/app/main.ts":                     "import { check } from \"@smthrs/errors\"\nexport const checked = check(\"a\")\n",
				"/app/tsconfig.json":               fmt.Sprintf(`{"compilerOptions":{"strict":true,"module":"nodenext","moduleResolution":"nodenext","allowImportingTsExtensions":true,"noEmit":true,"types":[]},"vibelang":%s,"files":["main.ts"]}`, test.importer),
			}
			if test.project != "" {
				files["/workspace/errors/tsconfig.json"] = test.project
			}
			for name, text := range fixtureRuntime(map[string]string{}) {
				files[name] = text
			}
			fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 || len(parsed.Errors) != 0 {
				t.Fatalf("config: %v / %v", errors, parsed.Errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			check := p.GetSourceFile("/workspace/errors/src/Check.vibe")
			if check == nil {
				t.Fatal("the program does not hold the workspace package's .vibe source")
			}
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), check) {
				if d.Code() == EK4401.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
					t.Errorf("unexpected diagnostic: %v", d.MessageText())
				}
			}
			if count != test.want {
				t.Fatalf("EK4401 count = %d, want %d", count, test.want)
			}
		})
	}
}

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
// package @acme/helper. The fixture installs no effect, so the app names
// produce instead of running it (a try needs an Effect type, VIP-5).
func projectFiles(producerTrust, appTrust string) map[string]string {
	return fixtureRuntime(map[string]string{
		"/node_modules/@acme/helper/package.json": `{"name":"@acme/helper","types":"index.d.ts"}`,
		"/node_modules/@acme/helper/index.d.ts":   `export declare function key(): number`,
		"/producer/package.json":                  `{"name":"@acme/producer"}`,
		"/producer/tsconfig.json":                 fmt.Sprintf(`{"compilerOptions":{"strict":true,"noEmit":true,"allowImportingTsExtensions":true},"vibelang":{"trustedPackages":%s},"include":["src"]}`, producerTrust),
		"/producer/src/lib.vibe":                  `import { key } from "@acme/helper"` + "\n" + `export effect function produce() { return key() }`,
		"/app/package.json":                       `{"name":"app"}`,
		"/app/main.vibe":                          `import { key } from "@acme/helper"` + "\n" + `import { produce } from "../producer/src/lib.vibe"` + "\n" + `export effect function use() { return [produce, key()] }`,
		"/app/tsconfig.json":                      fmt.Sprintf(`{"compilerOptions":{"strict":true,"noEmit":true,"allowImportingTsExtensions":true},"vibelang":{"trustedPackages":%s},"files":["main.vibe"]}`, appTrust),
	})
}

// untrustedCalls compiles config in files and returns the EK0403 count in
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
// EK0403 count in each named file, failing the test on any other error.
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
			if d.Code() == EK0403.Code {
				counts[i]++
			} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
				t.Errorf("unexpected diagnostic in %s: %v", name, d)
			}
		}
	}
	return counts
}

// VIP-4 and VIP-30 retire package trust. Neither a producer nor its importer
// can suppress foreign-call diagnostics through their old project settings.
func TestForeignVibeFileUsesItsOwnProjectSettings(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name                    string
		producerTrust, appTrust string
		foreign, own            int
	}{
		{"only the producer trusts the helper", `["@acme/helper"]`, `[]`, 1, 1},
		{"only the app trusts the helper", `[]`, `["@acme/helper"]`, 1, 1},
		{"both trust it", `["@acme/*"]`, `["@acme/helper"]`, 1, 1},
		{"neither trusts it", `[]`, `[]`, 1, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			counts := untrustedCalls(t, projectFiles(test.producerTrust, test.appTrust), "/app/tsconfig.json", "/producer/src/lib.vibe", "/app/main.vibe")
			if counts[0] != test.foreign || counts[1] != test.own {
				t.Fatalf("EK0403 in the producer, the app = %d, %d; want %d, %d", counts[0], counts[1], test.foreign, test.own)
			}
		})
	}
}

// Retired trust settings stay ignored when command-line files cause the
// compiler to discover each imported package's project.
func TestCommandLineProgramUsesEachPackageProjectSettings(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name          string
		producerTrust string
		appTrust      string
		foreign, own  int
	}{
		{"the producer's retired trust is ignored", `["@acme/helper"]`, `[]`, 1, 1},
		{"the app's retired trust is ignored", `[]`, `["@acme/helper"]`, 1, 1},
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
				t.Fatalf("EK0403 in the producer, the app = %d, %d; want %d, %d", counts[0], counts[1], test.foreign, test.own)
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
			t.Fatalf("trust %s: the producer's build reports %d EK0403, the app's build %d", trust, own[0], read[0])
		}
	}
}

// Extending a project cannot restore its retired trust exemption.
func TestSamePackageKeepsTheCompiledProjectSettings(t *testing.T) {
	t.Parallel()
	files := projectFiles(`[]`, `[]`)
	files["/producer/tsconfig.test.json"] = `{"extends":"./tsconfig.json","vibelang":{"trustedPackages":["@acme/helper"]}}`
	if counts := untrustedCalls(t, files, "/producer/tsconfig.test.json", "/producer/src/lib.vibe"); counts[0] != 1 {
		t.Fatalf("EK0403 under the test tsconfig = %d, want 1", counts[0])
	}
	if counts := untrustedCalls(t, files, "/producer/tsconfig.json", "/producer/src/lib.vibe"); counts[0] != 1 {
		t.Fatalf("EK0403 under the package tsconfig = %d, want 1", counts[0])
	}
}

// Linked workspace packages keep their foreign-call boundary with retired
// trust keys at either legacy path, in their own or the importing project.
func TestLinkedWorkspaceVibeFileUsesItsOwnProjectSettings(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name     string
		project  string // the workspace package's tsconfig.json, or "" for none
		importer string // the importing project's VibeLang settings
		want     int    // EK0403 reports in the workspace package's .vibe file
	}{
		{"the package's retired trust is ignored", `{"compilerOptions":{"strict":true},"vibelang":{"trustedPackages":["@smthrs/*"]}}`, `{}`, 1},
		{"compilerOptions.vibelang is ignored too", `{"compilerOptions":{"strict":true,"vibelang":{"trustedPackages":["@smthrs/*"]}}}`, `{}`, 1},
		{"the importer's trust does not reach it", `{"compilerOptions":{"strict":true}}`, `{"trustedPackages":["@smthrs/*"]}`, 1},
		{"a package without a project ignores the importer's trust", ``, `{"trustedPackages":["@smthrs/*"]}`, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			files := map[string]any{
				"/workspace/errors/package.json":   `{"name":"@smthrs/errors","type":"module","exports":{".":"./src/index.ts"}}`,
				"/workspace/errors/src/Code.ts":    `export function isCode(value: string): boolean { return value === "a" }`,
				"/workspace/errors/src/Check.vibe": "import { isCode } from \"./Code.ts\"\nexport effect function check(value: string) {\n  return isCode(value)\n}\n",
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
				if d.Code() == EK0403.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
					t.Errorf("unexpected diagnostic: %v", d.MessageText())
				}
			}
			if count != test.want {
				t.Fatalf("EK0403 count = %d, want %d", count, test.want)
			}
		})
	}
}

package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A rule that a VibeLang diagnostic ports runs as that diagnostic at the
// rule's severity. Chapter 7: once the plugin is enabled, "severity resolves
// from vibe.severities, then the repository's Effect language-service
// configuration, then the rule's default". The .ts twin of each module, in
// the same program, reports the imported rule at the severity the .vibe port
// must have, under the rule's lint code, as vibe.severities reports it. Before,
// the port ignored the plugin's diagnosticSeverity, so unnecessaryArrowBlock:
// "error" reported nothing in .vibe.
func TestPortsRunAtThePluginSeverity(t *testing.T) {
	const source = "export const inc = (n: number) => { return n + 1 }\n" +
		"export class Legacy extends Error {}\n"
	// Each port and the code its rule has in a .ts file.
	twins := map[int32]int32{4823: 38123, 4805: 3837}
	plugin := func(options string) string {
		return `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,` +
			`"plugins":[{"name":"@effect/language-service"` + options + `}]}`
	}
	for _, test := range []struct {
		name, config string
		vibe, ts     map[int32]string // code to category; a code not listed is not reported
	}{
		{name: "error", config: plugin(`,"diagnosticSeverity":{"unnecessaryArrowBlock":"error","extendsNativeError":"error"}`) + `}`,
			vibe: map[int32]string{38123: "error", 3837: "error"}, ts: map[int32]string{38123: "error", 3837: "error"}},
		{name: "warning", config: plugin(`,"diagnosticSeverity":{"unnecessaryArrowBlock":"warning","extendsNativeError":"warning"}`) + `}`,
			vibe: map[int32]string{38123: "warning", 3837: "warning"}, ts: map[int32]string{38123: "warning", 3837: "warning"}},
		{name: "suggestion", config: plugin(`,"diagnosticSeverity":{"unnecessaryArrowBlock":"suggestion","extendsNativeError":"suggestion"}`) + `}`,
			vibe: map[int32]string{38123: "suggestion", 3837: "suggestion"}, ts: map[int32]string{38123: "suggestion", 3837: "suggestion"}},
		{name: "off", config: plugin(`,"diagnosticSeverity":{"unnecessaryArrowBlock":"off","extendsNativeError":"off"}`) + `}`,
			vibe: map[int32]string{}, ts: map[int32]string{}},
		{name: "a file override", config: plugin(`,"diagnosticSeverity":{},"overrides":[{"include":["*.vibe"],"options":{"diagnosticSeverity":{"unnecessaryArrowBlock":"error"}}}]`) + `}`,
			vibe: map[int32]string{38123: "error", 4805: "warning"}, ts: map[int32]string{}},
		{name: "vibe.severities comes first", config: plugin(`,"diagnosticSeverity":{"unnecessaryArrowBlock":"error"}`) + `,"vibe":{"severities":{"EK38123":"warning"}}}`,
			vibe: map[int32]string{38123: "warning", 4805: "warning"}, ts: map[int32]string{38123: "warning"}},
		{name: "a disabled plugin leaves the port at its default", config: plugin(`,"diagnostics":false,"diagnosticSeverity":{"unnecessaryArrowBlock":"error","extendsNativeError":"error"}`) + `}`,
			vibe: map[int32]string{4805: "warning"}, ts: map[int32]string{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := portSeverityProgram(t, test.config[:len(test.config)-1]+`,"files":["m.vibe","t.ts"]}`, map[string]string{"m.vibe": source, "t.ts": source})
			for file, want := range map[string]map[int32]string{"m.vibe": test.vibe, "t.ts": test.ts} {
				for code := range twins {
					for _, c := range []int32{code, twins[code]} {
						if got[file][c] != want[c] {
							t.Errorf("%s EK%d: got %q, want %q (all: %v)", file, c, got[file][c], want[c], got)
						}
					}
				}
			}
		})
	}
}

// portSeverityProgram checks files under config, with effect installed, and
// returns each file's EK diagnostics as code to category name.
func portSeverityProgram(t *testing.T, config string, files map[string]string) map[string]map[int32]string {
	t.Helper()
	dir := t.TempDir()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "packages/runtime/node_modules/effect"), filepath.Join(dir, "node_modules", "effect")); err != nil {
		t.Fatal(err)
	}
	files["tsconfig.json"] = config
	files["package.json"] = `{"type":"module"}`
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(parsed.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, parsed.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	result := map[string]map[int32]string{"m.vibe": {}, "t.ts": {}}
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.File() == nil || d.Source() != diagnosticSource {
			continue
		}
		name := filepath.Base(d.File().FileName().AsString())
		if result[name] == nil {
			continue
		}
		result[name][d.Code()] = map[diagnostics.Category]string{diagnostics.CategoryError: "error", diagnostics.CategoryWarning: "warning", diagnostics.CategorySuggestion: "suggestion", diagnostics.CategoryMessage: "message"}[d.Category()]
	}
	return result
}

// EK4804 ports globalErrorInEffectCatch and globalErrorInEffectFailure and
// cannot tell which one a report answers. The plugin entry decides it only
// when both rules have one severity; otherwise it keeps its own default, so a
// project that turns off only globalErrorInEffectFailure keeps EK4804.
func TestTwoRulePortFollowsAnAgreedSeverity(t *testing.T) {
	const source = "export effect function f(n: number) {\n  if (n < 0) throw new Error(\"x\")\n  return n\n}\n"
	config := func(severities string) string {
		return `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,` +
			`"plugins":[{"name":"@effect/language-service","diagnosticSeverity":{` + severities + `}}]},"files":["m.vibe"]}`
	}
	for _, test := range []struct {
		severities string
		want       map[int32]string
	}{
		{``, map[int32]string{4804: "warning"}},
		{`"globalErrorInEffectFailure":"off"`, map[int32]string{4804: "warning"}},
		{`"globalErrorInEffectCatch":"error"`, map[int32]string{4804: "warning"}},
		{`"globalErrorInEffectFailure":"off","globalErrorInEffectCatch":"off"`, map[int32]string{}},
		{`"globalErrorInEffectFailure":"error","globalErrorInEffectCatch":"error"`, map[int32]string{3848: "error"}},
		{`"globalErrorInEffectFailure":"warning"`, map[int32]string{3849: "warning"}},
	} {
		got := portSeverityProgram(t, config(test.severities), map[string]string{"m.vibe": source})["m.vibe"]
		for _, code := range []int32{4804, 3848, 3849} {
			if got[code] != test.want[code] {
				t.Errorf("{%s}: EK%d is %q, want %q (all: %v)", test.severities, code, got[code], test.want[code], got)
			}
		}
	}
}

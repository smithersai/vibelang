package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// t3code (drive-t3code 2026-11-04T02:06Z): the conversion left 13
// @effect-diagnostics-next-line directives whose rule no longer fires on the
// VibeLang line, and each check printed TS377000. --fix keeps a directive's
// explanation as a plain comment and removes one that explains nothing.
func TestDeadEffectDirectiveEdits(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"no prose: the line goes",
			"function f() {\n  // @effect-diagnostics-next-line globalDate:off\n  const now = 1\n  return now\n}\n",
			"function f() {\n  const now = 1\n  return now\n}\n"},
		{"prose after a dash stays",
			"// @effect-diagnostics-next-line raceFirstWithSleepToTimeout:off - races the interval against a settings-change signal, not a timeout\nexport const a = 1\n",
			"// races the interval against a settings-change signal, not a timeout\nexport const a = 1\n"},
		{"prose after two dashes and two rules",
			"// @effect-diagnostics-next-line effectSucceedWithVoid:off globalDate:warning -- The SDK credential API requires undefined, not void.\nexport const a = 1\n",
			"// The SDK credential API requires undefined, not void.\nexport const a = 1\n"},
		{"prose after a colon",
			"// @effect-diagnostics-next-line preferSchemaOverJson:off: the body is a fixed shape\nexport const a = 1\n",
			"// the body is a fixed shape\nexport const a = 1\n"},
		{"prose without a separator",
			"// @effect-diagnostics-next-line globalDate:off read once at startup\nexport const a = 1\n",
			"// read once at startup\nexport const a = 1\n"},
		{"after code on its line",
			"export const a = [\n  1, // @effect-diagnostics-next-line globalDate:off\n  2,\n]\n",
			"export const a = [\n  1,\n  2,\n]\n"},
		{"a block comment",
			"/* @effect-diagnostics-next-line globalDate:off */\nexport const a = 1\n",
			"export const a = 1\n"},
		{"a block comment with prose",
			"/* @effect-diagnostics-next-line globalDate:off - fixed clock */\nexport const a = 1\n",
			"/* fixed clock */\nexport const a = 1\n"},
		{"CRLF line ends",
			"// @effect-diagnostics-next-line globalDate:off\r\nexport const a = 1\r\n",
			"export const a = 1\r\n"},
		{"the last line",
			"export const a = 1\n// @effect-diagnostics-next-line globalDate:off",
			"export const a = 1\n"},
		{"a string is not a comment",
			"export const a = \"// @effect-diagnostics-next-line globalDate:off\"\n",
			"export const a = \"// @effect-diagnostics-next-line globalDate:off\"\n"},
		{"a template is not a comment",
			"export const a = `\n// @effect-diagnostics-next-line globalDate:off\n`\n",
			"export const a = `\n// @effect-diagnostics-next-line globalDate:off\n`\n"},
		{"a line under a next-line directive stays",
			"// eslint-disable-next-line no-console\n// @effect-diagnostics-next-line globalDate:off\nexport const a = 1\n",
			"// eslint-disable-next-line no-console\n// @effect-diagnostics-next-line globalDate:off\nexport const a = 1\n"},
		{"a ported rule keeps its setting under VibeLang's code",
			"class E {\n  // @effect-diagnostics-next-line overriddenSchemaConstructor:off\n  constructor() {}\n}\n",
			"class E {\n  // @vibelang-diagnostics-next-line EK4814:off\n  constructor() {}\n}\n"},
		{"a ported rule keeps the prose, the other rule goes",
			"// @effect-diagnostics-next-line globalDate:off overriddenSchemaConstructor:off - decode never runs it\nexport const a = 1\n",
			"// @vibelang-diagnostics-next-line EK4814:off - decode never runs it\nexport const a = 1\n"},
		{"a ported rule in a block comment",
			"/* @effect-diagnostics-next-line overriddenSchemaConstructor:off */\nexport const a = 1\n",
			"/* @vibelang-diagnostics-next-line EK4814:off */\nexport const a = 1\n"},
		{"a ported rule at a suggestion severity goes",
			"// @effect-diagnostics-next-line overriddenSchemaConstructor:suggestion\nexport const a = 1\n",
			"export const a = 1\n"},
		{"a JSDoc line stays",
			"/**\n * @effect-diagnostics-next-line globalDate:off\n */\nexport const a = 1\n",
			"/**\n * @effect-diagnostics-next-line globalDate:off\n */\nexport const a = 1\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: tspath.CaseSensitive.PathKey("/main.vibe")}, test.source, core.ScriptKindTS)
			var positions []int
			for i := 0; ; {
				j := strings.Index(test.source[i:], effectNextLineMarker)
				if j < 0 {
					break
				}
				positions = append(positions, i+j)
				i += j + 1
			}
			// The test's port: EK4814 answers overriddenSchemaConstructor and
			// reports on every line.
			port := func(_ int, rule string) string {
				if rule == "overriddenSchemaConstructor" {
					return "EK4814"
				}
				return ""
			}
			got := applyEdits(test.source, deadEffectDirectiveEdits(file, positions, port))
			if got != test.want {
				t.Fatalf("got:\n%q\nwant:\n%q", got, test.want)
			}
		})
	}
}

// --fix rewrites the directives the program reports as TS377000, and only
// those: a directive that suppresses a diagnostic stays. globalDate does not
// run on a .vibe file (EK4403 answers it), so its directives have no effect;
// effectSleepZeroToYieldNow does run.
func TestFixRemovesDeadEffectDirectives(t *testing.T) {
	source := strings.Join([]string{
		"// @effect-diagnostics-next-line effectSleepZeroToYieldNow:off",
		"export const pause = Effect.sleep(0)",
		"export function plain() {",
		"  // @effect-diagnostics-next-line globalDate:off",
		"  const one = 1",
		"  // @effect-diagnostics-next-line globalDate:off - kept for the reader",
		"  return one",
		"}",
		"export const text = \"// @effect-diagnostics-next-line globalDate:off\"",
		"",
	}, "\n")
	want := strings.Join([]string{
		"// @effect-diagnostics-next-line effectSleepZeroToYieldNow:off",
		"export const pause = Effect.sleep(0)",
		"export function plain() {",
		"  const one = 1",
		"  // kept for the reader",
		"  return one",
		"}",
		"export const text = \"// @effect-diagnostics-next-line globalDate:off\"",
		"",
	}, "\n")
	fixed := fixDeadDirectives(t, source, want)
	if fixed.NativeCounts[effectDirectiveUnusedCode] != 2 {
		t.Errorf("counts %v, want TS377000 ×2", fixed.NativeCounts)
	}
}

// t3code contracts' Schema errors (filesystem.vibe, project.vibe): Effect's
// overriddenSchemaConstructor does not run on a .vibe file, and VibeLang's
// EK4814 reports the same constructor. The author's off stays, under EK4814.
func TestFixPortsDeadEffectDirective(t *testing.T) {
	source := strings.Join([]string{
		"export class BrowseError extends Schema.TaggedError<BrowseError>()(\"BrowseError\", {",
		"  message: Schema.String,",
		"}) {",
		"  // @effect-diagnostics-next-line overriddenSchemaConstructor:off",
		"  constructor(props: { readonly path: string }) {",
		"    super({ message: `Failed to browse ${props.path}` } as any)",
		"  }",
		"}",
		"",
	}, "\n")
	want := strings.Replace(source, "@effect-diagnostics-next-line overriddenSchemaConstructor:off", "@vibelang-diagnostics-next-line EK4814:off", 1)
	fixDeadDirectives(t, source, want)
}

// With the plugin entry raising overriddenSchemaConstructor, as t3code's base
// configuration does, EK4814 reports under the rule's lint code. The author's
// off still stays under EK4814, which silences that report.
func TestFixPortsDeadEffectDirectiveAtThePluginSeverity(t *testing.T) {
	source := strings.Join([]string{
		"export class BrowseError extends Schema.TaggedError<BrowseError>()(\"BrowseError\", {",
		"  message: Schema.String,",
		"}) {",
		"  // @effect-diagnostics-next-line overriddenSchemaConstructor:off",
		"  constructor(props: { readonly path: string }) {",
		"    super({ message: `Failed to browse ${props.path}` } as any)",
		"  }",
		"}",
		"",
	}, "\n")
	want := strings.Replace(source, "@effect-diagnostics-next-line overriddenSchemaConstructor:off", "@vibelang-diagnostics-next-line EK4814:off", 1)
	result, name, dir := fixEffectPluginSourceWith(t, source, `{"overriddenSchemaConstructor":"error"}`)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	if fixed := result.Files[name]; fixed == nil || fixed.Text != want {
		got := "(no fix)"
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("fixed text:\n%s\nwant:\n%s", got, want)
	}
	if err := os.WriteFile(name.AsString(), []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	program := fixProgram(bundled.WrapFS(osvfs.FS()), bundled.LibPath(), effectPluginConfig(t, dir), &fixParsedFiles{}, nil)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), program.GetSourceFile(name)) {
		if d.Code() == effectDirectiveUnusedCode || d.Category() == diagnostics.CategoryError {
			t.Errorf("the fixed program reports %s%d: %s", d.Source(), d.Code(), d.String())
		}
	}
}

// fixDeadDirectives runs --fix on main.vibe holding source, wants its text
// to be want, and wants the fixed program to report no TS377000 and no
// VibeLang warning, and a second --fix to change nothing.
func fixDeadDirectives(t *testing.T, source, want string) *FixedFile {
	t.Helper()
	result, name, dir := fixEffectPluginSource(t, source)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed := result.Files[name]
	if fixed == nil || fixed.Text != want {
		got := "(no fix)"
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("fixed text:\n%s\nwant:\n%s", got, want)
	}
	var report strings.Builder
	result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
	if !strings.Contains(report.String(), "TS377000 ×") {
		t.Errorf("report:\n%s", report.String())
	}
	if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0o600); err != nil {
		t.Fatal(err)
	}
	config := effectPluginConfig(t, dir)
	again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, FixOptions{})
	if again.Files[name] != nil && again.Files[name].Text != fixed.Text {
		t.Errorf("a second --fix changed the text:\n%s", again.Files[name].Text)
	}
	program := fixProgram(bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, &fixParsedFiles{}, nil)
	file := program.GetSourceFile(name)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		// Effect's parser also reads a marker in a string as a directive; --fix
		// leaves the string as it is.
		if d.Code() == effectDirectiveUnusedCode && inTrivia(file, d.Pos()) || d.Source() == diagnosticSource && (d.Code() == 4814 || d.Code() == 4403) {
			t.Errorf("the fixed program reports %s%d: %s", d.Source(), d.Code(), d.String())
		}
	}
	return fixed
}

// fixEffectPluginSource runs --fix on a project whose main.vibe is source,
// with Effect's language service on and two rules raised to warnings.
func fixEffectPluginSource(t *testing.T, source string) (*FixResult, tspath.RootedFilePath, string) {
	t.Helper()
	return fixEffectPluginSourceWith(t, source, `{"globalDate":"warning","effectSleepZeroToYieldNow":"warning"}`)
}

// fixEffectPluginSourceWith is fixEffectPluginSource with the plugin entry's
// diagnosticSeverity object.
func fixEffectPluginSourceWith(t *testing.T, source, severities string) (*FixResult, tspath.RootedFilePath, string) {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"plugins":[{"name":"@effect/language-service","diagnosticSeverity":`+severities+`}]},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), effectPluginConfig(t, dir), FixOptions{}), file.FileName(), dir
}

func effectPluginConfig(t *testing.T, dir string) *tsoptions.ParsedCommandLine {
	t.Helper()
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return config
}

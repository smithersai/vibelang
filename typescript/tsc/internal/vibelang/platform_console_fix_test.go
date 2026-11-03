package vibelang

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// vibelang --fix writes platform-console-fixed for platform-console.fail,
// apart from the expectation line, and fixing the twin changes nothing.
// VIP-33 console migration produces Console.log in effect code; rule: docs/design/vips/0033-platform-stdlib.md#25bcc63572d8add7
func TestPlatformConsoleCase(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	result := fixCase(t, copyCompilerFixture(t, filepath.Join(cases, "platform-console.fail"), root))
	if len(result.Refused) != 0 || len(result.Files) != 1 {
		t.Fatalf("fix: %+v", result)
	}
	var got string
	for _, fixed := range result.Files {
		got = fixed.Text
	}
	want, err := os.ReadFile(filepath.Join(cases, "platform-console-fixed/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	body := func(text string) string {
		_, rest, _ := strings.Cut(text, "\n")
		return rest
	}
	if body(got) != body(string(want)) {
		t.Fatalf("--fix writes\n%s\nwant\n%s", got, want)
	}
	if again := fixCase(t, copyCompilerFixture(t, filepath.Join(cases, "platform-console-fixed"), root)); len(again.Files) != 0 {
		t.Fatalf("fixing the twin again changes %v", again.Order)
	}
}

// Plain code keeps console and EK4402: try runs nothing there, and the
// migrate flow moves such code to TypeScript. So does a console call that is
// not a statement, and a console member Console lacks.
func TestPlatformConsoleFixLeavesWhatTryCannotRun(t *testing.T) {
	const source = "export function plain(name: string): number {\n  console.warn(name)\n  return 1\n}\n" +
		"export effect function held(name: string): number!never!never {\n  const log = console.log\n  console.group(name)\n  return name.length\n}\n"
	_, file, _, _ := editorProgram(t, source)
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{})
	for _, fixed := range result.Files {
		if strings.Contains(fixed.Text, "Console.") {
			t.Errorf("--fix wrote Console where try cannot run it:\n%s", fixed.Text)
		}
	}
	// Each EK4402 at a console call that stays says why, as a rewrite --fix declines does.
	program, file, _, _ := editorProgram(t, source)
	var notes []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4402.Code && strings.Contains(d.String(), "console.warn") {
			for _, n := range d.MessageChain() {
				notes = append(notes, n.String())
			}
		}
	}
	if !slices.ContainsFunc(notes, func(n string) bool { return strings.HasPrefix(n, "No quick fix: this is plain code") }) {
		t.Errorf("EK4402 at console.warn in plain code does not say why it has no fix: %q", notes)
	}
}

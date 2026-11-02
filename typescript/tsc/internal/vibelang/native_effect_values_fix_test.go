package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Bare interrupt and yieldNow are the pinned Effect values (VIP-6, VIP-33,
// RD-014), so the retired wrapper calls try interrupt() and try yieldNow() are
// TS2349. --fix-vip-only rewrites them as it rewrites any Effect value's
// call: try yieldNow, try interrupt. A second run writes nothing.
func TestFixVIPRunsNativeEffectValues(t *testing.T) {
	source := "export effect function main() {\n  try yieldNow()\n  try interrupt()\n}\n"
	want := "export effect function main() {\n  try yieldNow\n  try interrupt\n}\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != want {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	if len(again.Files) != 0 {
		t.Errorf("a second run wrote %+v", again.Files[file.FileName()])
	}
}

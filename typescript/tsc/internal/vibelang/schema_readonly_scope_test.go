package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// VIP-34/detail 186 scopes legacy upgrades explicitly. A valid new schema
// must keep its native writable fields during an ordinary --fix invocation.
func TestSchemaReadonlyMigrationScopes(t *testing.T) {
	source := "export schema S {value:number;nested:{flag:boolean};readonly fixed:string}\n"
	_, file, _, _ := editorProgram(t, source)
	configName := filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")
	configText := `{"compilerOptions":{"target":"ESNext","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`
	if err := os.WriteFile(configName, []byte(configText), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	ordinary := FixProject(t.Context(), fs, bundled.LibPath(), config)
	if ordinary.Err != nil || len(ordinary.Files) != 0 || len(ordinary.Refused) != 0 {
		t.Fatalf("ordinary fix changed valid writable source: %+v", ordinary)
	}
	legacy := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
	fixed := legacy.Files[file.FileName()]
	if legacy.Err != nil || fixed == nil || len(legacy.Refused) != 0 {
		t.Fatalf("missing explicit legacy migration: %+v", legacy)
	}
	for _, key := range []string{"value", "nested", "flag", "fixed"} {
		if !strings.Contains(fixed.Text, "readonly "+key) {
			t.Errorf("lost legacy key %s: %s", key, fixed.Text)
		}
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
	if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("legacy migration is not idempotent: %+v", again)
	}
}

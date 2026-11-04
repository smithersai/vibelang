package vibelang

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixLegacyEffectGlobals(t *testing.T) {
	for _, test := range []struct {
		name, source string
		off          bool
		want         string
	}{
		{"scope-first", "import type {Scope} from \"effect\"; export effect function f(scope:Scope.Scope){const fiber=try forkIn(scope,succeed(1));return try Fiber.join(fiber)}", false, "do { const $legacyForkScope"},
		{"scope-first-types", "import type {Scope} from \"effect\"; export effect function f(scope:Scope.Scope){const fiber=try forkIn<number,never,never>(scope,succeed(1));return try Fiber.join(fiber)}", false, ".forkIn<number, never, never>"},
		{"nested", "import type {Scope} from \"effect\"; export effect function f(scope:Scope.Scope){const a=try forkIn(scope,succeed(1));const b=try forkIn(scope,Fiber.join(a));return try Fiber.join(b)}", false, "$legacyForkProgram"},
		{"disabled-sync", "export effect function f(){return try sync(()=>1)}", true, "export effect function f"},
		{"disabled-values", "export const values={sync,callback,forkIn}", true, "sync: $legacyGlobalsync"},
		{"type-shadow", "type sync=number;export const value:sync=1;export const fn=sync", true, "type sync=number"},
		{"native-stays", "import type {Scope} from \"effect\"; export effect function f(scope:Scope.Scope){const fiber=try forkIn(succeed(1),scope);return try Fiber.join(fiber)}", false, ""},
		{"shadow-stays", "const forkIn=(a:number,b:number)=>a+b;export const value=forkIn(1,2)", false, ""},
	} {
		for _, options := range []FixOptions{{}, {MigrationOnly: true}} {
			t.Run(test.name+"/"+strconv.FormatBool(options.MigrationOnly)+"/"+strconv.FormatBool(options.VIPOnly), func(t *testing.T) {
				p := nativeGlobalsProgram(t, test.source, test.off)
				fixed := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), options)
				if fixed.Err != nil || len(fixed.Refused) > 0 {
					t.Fatalf("fix: %v %+v", fixed.Err, fixed.Refused)
				}
				text := test.source
				for name, f := range fixed.Files {
					if strings.HasSuffix(name.AsString(), "/main.vibe") {
						text = f.Text
					}
				}
				if test.want == "" {
					if len(fixed.Files) != 0 {
						t.Fatalf("control changed: %s", text)
					}
					return
				}
				if !strings.Contains(text, test.want) {
					t.Fatalf("missing %s: %s", test.want, text)
				}
				after := nativeGlobalsProgram(t, text, test.off)
				for _, d := range after.GetSemanticDiagnostics(t.Context(), nil) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("repaired source: %s\n%s", d.String(), text)
					}
				}
				for _, file := range after.GetSourceFiles() {
					if !file.FileName().IsVibeLangSource() {
						continue
					}
					if err := os.WriteFile(filepath.Clean(file.FileName().AsString()), []byte(text), 0600); err != nil {
						t.Fatal(err)
					}
				}
				again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), after.CommandLine(), options)
				if again.Err != nil || len(again.Files) > 0 {
					t.Fatalf("not idempotent: %v %v", again.Err, again.Order)
				}
			})
		}
	}
}

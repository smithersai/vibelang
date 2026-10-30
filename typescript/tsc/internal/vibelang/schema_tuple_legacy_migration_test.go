package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestNestedTupleLegacyMigration(t *testing.T) {
	for _, test := range []struct {
		source, want string
		count        int
	}{
		{"namespace N {export schema T=[name:string,count?:number]}\n", "schema T=Schema.Unknown", 1},
		{"namespace N {export schema T=readonly [string,...number[]]}\n", "schema T=Schema.Unknown", 1},
		{"namespace N {export schema T=ReadonlyArray<[string,number?]>}\n", "ReadonlyArray<Schema.Unknown>", 1},
		{"function local():infer _ {schema T=([name:string]);return T}\n", "(Schema.Unknown)", 1},
		{"namespace N {export schema T=[string,[name:number]]}\n", "[string,Schema.Unknown]", 1},
		{"namespace N {export schema T=[outer:[inner:number]]}\n", "schema T=Schema.Unknown", 1},
		{"namespace N {export schema T=[string?,number]}\n", "schema T=Schema.Unknown", 1},
		{"export schema T=[name:string,count?:number]\n", "schema T=[name:string,count?:number]", 0},
		{"namespace N {export schema T={items:[name:string]}}\n", "items:[name:string]", 0},
		{"namespace N {export schema T=Readonly<[name:string]>}\n", "Readonly<[name:string]>", 0},
	} {
		t.Run(test.source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			p := schemaTupleLegacyMigrationFixes(t.Context(), program, file, map[string]bool{})
			if len(p.fixes) != test.count || !strings.Contains(p.text(), test.want) {
				t.Fatalf("got %d upgrades, want %d / %q:\n%s", len(p.fixes), test.count, test.want, p.text())
			}
			checked, next, _, _ := editorProgram(t, p.text())
			if again := schemaTupleLegacyMigrationFixes(t.Context(), checked, next, map[string]bool{}); len(again.fixes) != 0 {
				t.Fatalf("not idempotent: %s", again.text())
			}
		})
	}
}

func TestNestedTupleLegacyProjectScope(t *testing.T) {
	source := "export namespace N {export schema T=readonly [name:string,count?:number]}\n"
	for _, mode := range []struct {
		name    string
		options FixOptions
		changed bool
	}{{"ordinary", FixOptions{}, false}, {"compatibility", FixOptions{MigrationOnly: true}, true}} {
		t.Run(mode.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source)
			fs := bundled.WrapFS(osvfs.FS())
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), mode.options)
			if len(result.Refused) != 0 {
				t.Fatalf("refused:%+v", result.Refused)
			}
			fixed := result.Files[file.FileName()]
			if !mode.changed {
				if fixed != nil {
					t.Fatalf("ordinary fix changed valid new tuple: %s", fixed.Text)
				}
				return
			}
			if fixed == nil || !strings.Contains(fixed.Text, "schema T=Schema.Unknown") {
				t.Fatalf("missing compatibility fix:%+v", fixed)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), mode.options)
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("second fix:%+v", again)
			}
		})
	}
}

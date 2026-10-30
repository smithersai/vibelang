package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestDataPayloadReadonlyProjectUpgrade(t *testing.T) {
	for _, mode := range []struct {
		name    string
		options FixOptions
	}{{"migration-only", FixOptions{MigrationOnly: true}}} {
		t.Run(mode.name, func(t *testing.T) {
			source := "export data P {V {nested:{count:number;readonly fixed:string;mutable open:number};values:{flag:boolean}[]}}\n"
			p, file, _, _ := editorProgram(t, source)
			fs := bundled.WrapFS(osvfs.FS())
			fixed := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), mode.options)
			if len(fixed.Refused) != 0 {
				t.Fatalf("refused safe upgrade: %+v", fixed.Refused)
			}
			f := fixed.Files[file.FileName()]
			if f == nil || !strings.Contains(f.Text, "nested:{readonly count:") || !strings.Contains(f.Text, "values:{readonly flag:") {
				t.Fatalf("missing preserving upgrade: %+v", f)
			}
			if strings.Contains(f.Text, "readonly open") || !strings.Contains(f.Text, "mutable open:") {
				t.Fatalf("changed explicit mutable field: %s", f.Text)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(f.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), mode.options)
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("second upgrade not empty: %+v", again)
			}
		})
	}
}

func TestDataPayloadReadonlyOrdinaryFixKeepsCurrentProgram(t *testing.T) {
	for _, source := range []string{
		"export data P {V {nested:{count:number};dictionary:{[key:string]:number}}}\n",
		"export data P {V {nested:{count:number};dictionary:{[key:string]:number}}}\nexport function edit(p:P):number {p.dictionary[\"count\"]=1;return ++p.nested.count}\n",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("current-program control rejected: %s", d.String())
				}
			}
			fixed := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			if len(fixed.Refused) != 0 || len(fixed.Files) != 0 {
				t.Fatalf("ordinary --fix changed or refused valid current code: %+v", fixed)
			}
		})
	}
}

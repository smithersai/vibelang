package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"strings"
	"testing"
)

func TestFixServiceDefaultNative(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         bool
	}{
		{"typed", "service Flags {static readonly key=\"native-default/Flags\";static readonly default: Flags.Shape={n:7};n:number}\nexport type Value=typeof Flags.default\nexport const value=Flags.default\n", true},
		{"untyped", "service Flags {static readonly key=\"native-default/Flags\";static readonly default={n:7};n:number}\nexport const value=Flags.default\n", true},
		{"literal data", "service Flags {static readonly key=\"native-default/Flags\";static readonly default=7;n:number}\nexport const value=Flags.default\n", true},
		{"recursive", "service Flags {static readonly key=\"native-default/Flags\";static readonly default:Flags.Shape={n:7};n:number;next?:Flags.Shape}\nexport type Shape=Flags.Shape\nexport const value=Flags.default\n", true},
		{"nested", "export effect function use(){service Flags {static readonly key=\"native-default/Flags\";static readonly default={n:7};n:number};return Flags.default}\n", true},
		{"mutable shape", "service Flags {static readonly key=\"native-default/Flags\";static readonly default:Flags.Shape={n:7,nested:{count:1}};n:number;readonly fixed?:true;nested:{count:number}}\nexport effect function use(){Flags.default.n++;Flags.default.nested.count++;return Flags.default}\n", true},
		{"exported stays", "export service Flags {static readonly key=\"native-default/Flags\";static readonly default={n:7};n:number}\n", false},
		{"export list stays", "service Flags {static readonly key=\"native-default/Flags\";static readonly default={n:7};n:number}\nexport {Flags}\n", false},
		{"comment stays", "service Flags {static readonly key=\"native-default/Flags\";/** cached */static readonly default={n:7};n:number}\n", false},
		{"reference stays", "service Flags {static readonly key=\"native-default/Flags\";static readonly default={n:7};static readonly defaultValue=()=>({n:9});n:number}\n", false},
		{"native stays", "class Flags extends Object {static readonly default={n:7}}\nexport const value=Flags.default\n", false},
	} {
		options := []FixOptions{{MigrationOnly: true}, {VIPOnly: true}, {}}
		if tc.name == "mutable shape" {
			// The explicit pre-flip readonly upgrade has a different input
			// contract; current mutable fields exercise ordinary/VIP fixes.
			options = []FixOptions{{VIPOnly: true}, {}}
		}
		for mode, opts := range options {
			t.Run(tc.name+string(rune('0'+mode)), func(t *testing.T) {
				p, file, _, _ := editorProgram(t, tc.source)
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("invalid generator: %s", d.String())
					}
				}
				fixed := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), opts)
				if fixed.Err != nil || len(fixed.Refused) > 0 {
					t.Fatalf("%v; refused %+v", fixed.Err, fixed.Refused)
				}
				text := tc.source
				if f := fixed.Files[file.FileName()]; f != nil {
					text = f.Text
				}
				if strings.Contains(text, "class Flags extends $legacyServiceContext") != tc.want {
					t.Fatalf("native=%v: %s", tc.want, text)
				}
				if tc.want && (strings.Contains(text, "defaultValue") || !strings.Contains(text, "static readonly default")) {
					t.Fatalf("cached static field changed: %s", text)
				}
				if tc.want && strings.Contains(text, "Flags.Shape") {
					t.Fatalf("legacy self shape remains in native class: %s", text)
				}
				after, af, _, _ := editorProgram(t, text)
				for _, d := range after.GetSemanticDiagnostics(t.Context(), af) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("fixed source: %s\n%s", d.String(), text)
					}
				}
				again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), after.CommandLine(), opts)
				if again.Err != nil || len(again.Files) > 0 {
					t.Fatalf("not idempotent: %v %d", again.Err, len(again.Files))
				}
			})
		}
	}
}

func TestOrdinaryAbstractStaticDefault(t *testing.T) {
	p, file, _, _ := editorProgram(t, "abstract class Flags {static readonly default={n:7};abstract n:number}\n")
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4855.Code {
			t.Fatalf("ordinary TypeScript field treated as a service default: %s", d.String())
		}
	}
}

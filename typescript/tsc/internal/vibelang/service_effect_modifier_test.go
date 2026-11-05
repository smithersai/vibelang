package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestServiceEffectModifierOwnership(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         int32
	}{
		{"service", "service S { effect read(): number!! }; export {};", 902},
		{"service-optional", "service S { effect read?(): number!! }; export {};", 902},
		{"service-generic", "service S { effect read<T>(x: T): T!! }; export {};", 902},
		{"service-computed", "service S { effect [\"read\"](): number!! }; export {};", 902},
		{"service-comments", "service S { effect /* retain */ read(): number!! }; export {};", 902},
		{"shape-service", "service S: {} { effect read(): number!! }; export {};", 902},
		{"interface", "interface S { effect read(): number!! }; export {};", 108},
		{"literal", "type S = { effect read(): number!! }; export {};", 108},
		{"written-abstract", "abstract class S { abstract effect read(): number!! }; export {};", 108},
		{"ambient", "declare class S { effect read(): number!! }; export {};", 108},
		{"service-identifier", "service S { effect(): number!! }; export {};", 0},
		{"service-contract", "service S { read(): number!! }; export {};", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == diagnosticSource && d.Code() == tc.want {
					count++
					continue
				}
				t.Errorf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.String())
			}
			want := 1
			if tc.want == 0 {
				want = 0
			}
			if count != want {
				t.Fatalf("want %d EK%04d, got %d: %s", want, tc.want, count, tc.source)
			}
		})
	}
}

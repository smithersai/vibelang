package vibelang

import (
	"fmt"
	"testing"
)

func TestSchemaTypeParameterCompilerDiagnostic(t *testing.T) {
	for _, source := range []string{"schema User<T> {name:string}", "schema User<T> = string"} {
		program, file, _, _ := editorProgram(t, source)
		ds := program.GetSyntacticDiagnostics(t.Context(), file)
		if len(ds) == 0 {
			ds = program.GetSemanticDiagnostics(t.Context(), file)
		}
		var codes []string
		for _, d := range ds {
			prefix := d.Source()
			if prefix == "" {
				prefix = "TS"
			}
			codes = append(codes, fmt.Sprintf("%s%04d: %s", prefix, d.Code(), d.String()))
		}
		if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1502 {
			t.Errorf("want only EK1502 for %s; got %v", source, codes)
		}
	}
}

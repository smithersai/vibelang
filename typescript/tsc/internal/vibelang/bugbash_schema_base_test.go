package vibelang

import (
	"strings"
	"testing"
)

func TestBugBashSchemaErrorBaseText(t *testing.T) {
	for _, tc := range []struct {
		name, source, want, absent string
		code                       int32
	}{
		{"schema base expression", `schema error E extends { id: string }`, "cannot have an extends clause", "and  is not one", 2117},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				text := diagnosticWithNotes(d)
				if strings.Contains(text, tc.absent) {
					t.Errorf("leaked %q: %s", tc.absent, text)
				}
				if d.Code() == tc.code {
					found = true
					if !strings.Contains(text, tc.want) {
						t.Errorf("missing %q: %s", tc.want, text)
					}
				}
			}
			if !found {
				t.Fatalf("missing diagnostic %d", tc.code)
			}
		})
	}
}

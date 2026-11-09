package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func multipleRestSpreadKeys() []string {
	var result []string
	for _, key := range variadicSpreadKeys() {
		parts := strings.Split(key, ":")
		if parts[2] != "safe" && parts[2] != "risky" || parts[1] == "other" {
			continue
		}
		for _, position := range []string{"before", "after", "fixed-tail"} {
			result = append(result, key+":"+position)
		}
	}
	return result
}
func multipleRestSpreadSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	base := strings.Join(parts[:3], ":")
	source, library, want := variadicSpreadSource(base, choice)
	array := "args"
	element := parts[2]
	if choice&2 != 0 {
		element = "(" + element + ")"
	}
	if parts[0] == "inline" {
		array = "[" + element + "]"
	}
	if choice&16 != 0 {
		array = "(" + array + ")"
	}
	prefix := ""
	if choice&1 != 0 {
		prefix = "1,"
	}
	callee := "strict"
	if choice&8 != 0 {
		callee = "new Holder"
	}
	args := "..." + array
	switch parts[3] {
	case "before":
		args = "...first," + args
	case "after":
		args += ",...second"
	case "fixed-tail":
		args += ",...([safe] as const)"
	}
	old := callee + "(" + prefix + "..." + array + ")"
	next := callee + "(" + prefix + args + ")"
	if !strings.Contains(source, old) {
		panic("missing callback invocation")
	}
	source = strings.Replace(source, old, next, 1)
	source = strings.Replace(source, "export ", "const first=[safe]\nconst second=[safe]\nexport ", 1)
	return source, library, want
}
func TestMultipleRestSpreadCallbackContracts(t *testing.T) {
	for _, key := range multipleRestSpreadKeys() {
		for _, choice := range []uint8{0, 1, 4, 8, 16, 64} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) {
				source, library, want := multipleRestSpreadSource(key, choice)
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
				var got []int
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() != diagnosticSource {
						t.Errorf("unexpected: %s", d.String())
					}
					got = append(got, int(d.Code()))
				}
				if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
					t.Errorf("got %v, want EK%04d (zero means none)", got, want)
				}
			})
		}
	}
}

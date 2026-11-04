package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestLayerRepairWritesCurrentBlockArgument(t *testing.T) {
	for _, body := range []string{
		"const value=7; effect read(){return value}",
		"const value=/* keep value */7; effect read(){return /* keep read */ value}",
		"effect read(){return 7}",
	} {
		for _, crlf := range []bool{false, true} {
			source := "/* café 😀 */\nservice Users {read():number!!}\nlayer Live:Users {" + body + "}\nexport effect function main(){provide Live{return try Users.read()}}\n"
			if crlf {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			t.Run(body, func(t *testing.T) {
				p, f, _, _ := editorProgram(t, source)
				got := fileFixes(t.Context(), p, f, nil, []int32{2121}).text()
				if got == source {
					t.Fatal("missing layer repair")
				}
				checked, file, _, _ := editorProgram(t, got)
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), file), checked.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("repair adds %s\n%s", d.String(), got)
					}
				}
				for _, comment := range []string{"/* café 😀 */", "/* keep value */", "/* keep read */"} {
					if strings.Count(source, comment) != strings.Count(got, comment) {
						t.Fatalf("lost %s", comment)
					}
				}
			})
		}
	}
}

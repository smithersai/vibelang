package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixCallbackDependentHelperAnnotation(t *testing.T) {
	for _, prefix := range []string{"", "import {Effect} from 'effect';\n"} {
		t.Run(prefix, func(t *testing.T) {
			source := prefix + `function modality(value:string){return value.split("/")[0]}
function modalities(values:readonly string[]){return values.map(modality)}
const output:string[]=modalities(["image/png"])
export {output}
`
			p, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			fixed := source
			if change := result.Files[file.FileName()]; change != nil {
				fixed = change.Text
			}
			if len(result.Refused) != 0 {
				t.Errorf("mechanical helper annotations refused: %+v", result.Refused)
			}
			checked, next, _, _ := editorProgram(t, fixed)
			for _, d := range checked.GetSemanticDiagnostics(t.Context(), next) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("after fix: %s", d.String())
				}
			}
			if strings.Contains(fixed, "Effect.Effect<string") {
				t.Errorf("captured stale callback result in annotation: %s", fixed)
			}
		})
	}
}

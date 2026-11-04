package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

// The qualified Alchemy tree retains ToQueue.ts and rewrites its Rule import
// to Rule.vibe. Declaration module selection must still match the original
// all-TypeScript project; choosing the index loads unrelated augmentations.
func TestDeclarationTypeScriptConsumerOfVibeModule(t *testing.T) {
	for _, declaring := range []string{"vibe", "ts"} {
		for _, reexporter := range []string{"ts", "vibe"} {
			for _, named := range []bool{false, true} {
				for _, depth := range []int{1, 2} {
					t.Run(fmt.Sprintf("%s-%s-named%v-depth%d", declaring, reexporter, named, depth), func(t *testing.T) {
						twin, name := reexportContainerFiles("ts", "ts", "ts", named, depth)
						files, _ := reexportContainerFiles(declaring, reexporter, "vibe", named, depth)
						source := "/workspace/x/src/" + strings.TrimSuffix(name, ".d.ts")
						files[source+".ts"] = files[source+".vibe"]
						delete(files, source+".vibe")
						want := reexportSpecifier(t, twin, name)
						got := reexportSpecifier(t, files, name)
						if specifierModule(want) != specifierModule(got) {
							t.Fatalf("TypeScript importer got %q; all-TypeScript twin wants %q", got, want)
						}
					})
				}
			}
		}
	}
}

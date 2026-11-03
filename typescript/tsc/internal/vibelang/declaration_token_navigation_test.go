package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/astnav"
)

func TestServiceEditorTokenCache(t *testing.T) {
	for _, source := range []string{`service Users { find(id:string):string }`, `export service Users { readonly name:string }`, `error Missing { id:string }`, `schema error Missing { id:string }`, `class service { field:string }`, `const service=()=>()=>{}; @service() service Users { name:string }`} {
		t.Run(source, func(t *testing.T) {
			defer func() {
				if failure := recover(); failure != nil {
					t.Errorf("editor request panicked: %v", failure)
				}
			}()
			_, file, _, _ := editorProgram(t, source)
			for i := 0; i < len(source); i++ {
				astnav.GetTouchingToken(file, i)
				astnav.FindPrecedingToken(file, i)
			}
			// Repeating requests in reverse order must use the same token cache.
			for i := strings.Index(source, " "); i >= 0; i-- {
				astnav.FindPrecedingToken(file, i)
				astnav.GetTouchingToken(file, i)
			}
		})
	}
}

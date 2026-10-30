package vibelangmapper

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/contentmapper"
)

// The mapper must not retain automatic spans after the native compiler
// removes the unsupported option.
func TestAutomaticTracingOptionRejected(t *testing.T) {
	for _, mode := range []string{"none", "exported", "all"} {
		t.Run(mode, func(t *testing.T) {
			result, err := (&Handler{}).HandleRequest(t.Context(), contentmapper.MethodOpenProject,
				[]byte("{\"configFileName\":\"\",\"projectHandle\":\"p\",\"options\":{\"tracing\":\""+mode+"\"},\"compilerOptions\":{}}"))
			if err != nil {
				t.Fatal(err)
			}
			diagnostics := result.(contentmapper.OpenProjectResult).OptionDiagnostics
			if len(diagnostics) != 1 || diagnostics[0].Code != CodeInvalidOption || !strings.Contains(diagnostics[0].MessageText, "tracing") {
				t.Fatalf("automatic tracing accepted: %v", diagnostics)
			}
		})
	}
}

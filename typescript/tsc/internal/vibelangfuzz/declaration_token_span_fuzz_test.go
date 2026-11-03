package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"strings"
	"testing"
)

const declarationEditorQuote = "4. **Existing tools work.**"

func TestServiceEditorTokenSpanQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), declarationEditorQuote) {
		t.Fatal("VIP-34 tooling contract changed")
	}
}

func FuzzServiceEditorTokenSpan(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"service", "error", "schema-error", "decorator", "native-name", "control"} {
		f.Add(key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice byte) {
		name := []string{"Users", "Settings", "Café"}[int(choice)%3]
		source := fmt.Sprintf(`service %s { static readonly key="tests/Users"; name:string }`, name)
		switch key {
		case "error":
			source = fmt.Sprintf(`error %s { name:string }`, name)
		case "schema-error":
			source = fmt.Sprintf(`schema error %s { name:string }`, name)
		case "decorator":
			source = `const service=()=>()=>{}; @service() ` + source
		case "native-name":
			source = `class service { name:string }`
		case "control":
			source = fmt.Sprintf(`control %s { approve():boolean!! }`, name)
		}
		if choice&1 != 0 {
			source = "// prefix\nexport " + source
		}
		r := toolsCompile(t, w, "FuzzEditor", map[string]string{"main.vibe": source})
		defer r.Remove()
		file := r.SourceFile("main.vibe")
		if file == nil {
			t.Fatal("missing editor source")
		}
		for offset := 0; offset <= len(source); offset++ {
			astnav.GetTouchingToken(file, offset)
			astnav.FindPrecedingToken(file, offset)
		}
		for offset := len(source); offset >= 0; offset-- {
			astnav.FindPrecedingToken(file, offset)
			astnav.GetTouchingToken(file, offset)
		}
	})
}

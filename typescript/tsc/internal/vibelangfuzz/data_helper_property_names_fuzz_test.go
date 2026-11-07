package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const dataHelperPropertyTarget = "FuzzDataHelperPropertyNames"
const dataHelperPropertyQuote = "The helper for `data Outcome<A, E>` is named `$Outcome$Definition`, or `$Outcome$Definition$2`, `$3`, … when the module already declares that name, so it never collides with a user name and is the same on every build."

var dataHelperPropertyShapes = []struct{ key, source string }{
	{"object-key", "const object={NAME:1};"},
	{"type-key", "interface Shape{NAME:number};"},
	{"class-field", "class Holder{NAME=1};"},
	{"object-method", "const object={NAME(){return 1}};"},
	{"class-method", "class Holder{NAME(){return 1}};"},
	{"property-read", "const object={NAME:1};const kept=object.NAME;"},
	{"qualified-type-query", "const object={NAME:1};type Kept=typeof object.NAME;"},
	{"binding-property", "const object={NAME:1};const {NAME:kept}=object;"},
}

func dataHelperPropertyQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("006-data.md"), dataHelperPropertyQuote) {
		t.Fatal("generic data helper naming authority changed")
	}
}

func TestDataHelperPropertyNamesQuoted(t *testing.T) { dataHelperPropertyQuoted(t) }

// Property selectors occupy their object's member namespace. Vary the first
// available lexical helper slot, escaped property spelling and member syntax;
// verify the actual emitted declaration rather than only accepting the source.
func FuzzDataHelperPropertyNames(f *testing.F) {
	startShortBudget(f)
	dataHelperPropertyQuoted(f)
	for _, shape := range dataHelperPropertyShapes {
		for mode := uint8(0); mode < 6; mode++ {
			f.Add(shape.key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		index := slices.IndexFunc(dataHelperPropertyShapes, func(shape struct{ key, source string }) bool { return shape.key == key })
		if index < 0 {
			index = int(mode) % len(dataHelperPropertyShapes)
			key = dataHelperPropertyShapes[index].key
		}
		mode %= 6
		occupied := int(mode % 3)
		name := "$Box$Definition"
		prefix := ""
		for n := 0; n < occupied; n++ {
			current := "$Box$Definition"
			if n > 0 {
				current += fmt.Sprintf("$%d", n+1)
			}
			prefix += "type " + current + "=number;"
		}
		if occupied > 0 {
			name += fmt.Sprintf("$%d", occupied+1)
		}
		spelling := name
		if mode >= 3 {
			spelling = strings.Replace(spelling, "$Definition", `\u0024Definition`, 1)
		}
		source := prefix + strings.ReplaceAll(dataHelperPropertyShapes[index].source, "NAME", spelling) + "export data Box<A>{Row{value:A}}"
		result, err := w.Compile(t.Context(), Project{
			Files:  map[string]string{"main.vibe": source},
			Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"outDir":"out","types":[]},"files":["main.vibe"]}`,
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, dataHelperPropertyTarget, fmt.Sprintf("diagnostic:%s:%d", key, mode), "unexpected %s\n%s", specDiagnosticText(d), source)
				return
			}
		}
		out := result.Outputs["out/main.d.ts"]
		if !strings.Contains(out, "interface "+name+" extends") {
			Gap(t, dataHelperPropertyTarget, fmt.Sprintf("helper:%s:%d", key, mode), "%s: want first free helper %s\n%s\n%s", dataHelperPropertyQuote, name, source, out)
		}
	})
}

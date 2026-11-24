package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestErrorRegistrationMembersQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), "A class arm whose class has its own `Symbol.customMatcher`") {
		t.Fatal("own matcher authority changed")
	}
}
func FuzzErrorRegistrationMembers(f *testing.F) {
	startShortBudget(f)
	for flags := uint8(0); flags < 4; flags++ {
		f.Add(flags, false)
		f.Add(flags, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, flags uint8, unicode bool) {
		TestErrorRegistrationMembersQuoted(t)
		prefix := ""
		if flags&1 != 0 {
			prefix = "schema "
		}
		payload := "code:string;"
		if flags&2 != 0 {
			payload = ""
		}
		label := "docs"
		if unicode {
			label = "café 😀"
		}
		source := prefix + "error E {" + payload + fmt.Sprintf("read(){return 1}get label(){return %q}}", label)
		result := toolsCompile(t, w, "FuzzErrorRegistrationMembers", Single(source).Files)
		defer result.Remove()
		if !toolsErrorFree(result) {
			t.Fatalf("invalid error declaration: %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
		}
		file := toolsParse("members.vibe", source)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Fatalf("native member grammar: %s", ds[0].String())
		}
		if len(file.Statements.Nodes) != 1 || !ast.IsClassDeclaration(file.Statements.Nodes[0]) {
			t.Fatal("error declaration lost its class")
		}
		members := file.Statements.Nodes[0].Members()
		if len(members) == 0 || members[0].Kind != ast.KindClassStaticBlockDeclaration || members[0].Flags&ast.NodeFlagsReparsed == 0 {
			t.Fatal("generated matcher registration must precede authored members")
		}
		var got []string
		for _, member := range members {
			if name := member.Name(); name != nil && slices.Contains([]string{"read", "label"}, name.Text()) {
				if member.Flags&ast.NodeFlagsReparsed != 0 {
					t.Fatal("authored member became synthetic")
				}
				got = append(got, name.Text())
			}
		}
		if !slices.Equal(got, []string{"read", "label"}) {
			t.Fatalf("authored member order changed: %v", got)
		}
	})
}

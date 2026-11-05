package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"slices"
	"strings"
	"testing"
)

func TestErrorRegistrationMembersQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), "A class arm whose class has its own `Symbol.customMatcher`") {
		t.Fatal("own matcher authority changed")
	}
}
func FuzzErrorRegistrationMembers(f *testing.F) {
	startShortBudget(f)
	for flags := uint8(0); flags < 16; flags++ {
		f.Add(flags, false)
		f.Add(flags, true)
	}
	f.Fuzz(func(t *testing.T, flags uint8, unicode bool) {
		TestErrorRegistrationMembersQuoted(t)
		prefix := ""
		if flags&1 != 0 {
			prefix = "schema "
		}
		if flags&2 != 0 {
			prefix = "abstract " + prefix
		}
		base := ""
		if flags&4 != 0 {
			base = " extends Base"
		}
		payload := "code:string;"
		if flags&8 != 0 {
			payload = ""
		}
		label := "docs"
		if unicode {
			label = "café 😀"
		}
		source := prefix + "error E" + base + "{" + payload + fmt.Sprintf("static readonly docs=%q;", label) + "read(){return 1}get label(){return 'label'}}"
		file := toolsParse("members.vibe", source)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Fatalf("native member grammar: %s", ds[0].String())
		}
		if len(file.Statements.Nodes) != 1 || !ast.IsClassDeclaration(file.Statements.Nodes[0]) {
			t.Fatal("error declaration lost its class")
		}
		members := file.Statements.Nodes[0].Members()
		if len(members) == 0 || members[0].Kind != ast.KindClassStaticBlockDeclaration || members[0].Flags&ast.NodeFlagsReparsed == 0 {
			t.Fatal("generated matcher registration must precede authored static initialization")
		}
		var got []string
		for _, member := range members {
			if name := member.Name(); name != nil && slices.Contains([]string{"docs", "read", "label"}, name.Text()) {
				if member.Flags&ast.NodeFlagsReparsed != 0 {
					t.Fatal("authored member became synthetic")
				}
				got = append(got, name.Text())
				if name.Text() == "docs" && (!ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) || !ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly)) {
					t.Fatal("authored static readonly member changed")
				}
			}
		}
		if !slices.Equal(got, []string{"docs", "read", "label"}) {
			t.Fatalf("authored member order changed: %v", got)
		}
	})
}

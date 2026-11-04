package vibelangfuzz

import (
	"fmt"
	"testing"
)

// Chapter 007 EK4856 and its preservation rule cover API aliases and heritage
// without changing ordinary caller observations. Every saved generator runs
// through the existing strict CLI/editor, API-identity and runtime oracle.
func TestQuickFixLegacyAliasPreservation(t *testing.T) {
	TestQuickFixBehaviorQuoted(t)
	w := NewWorkspace(t)
	binary := cliBuild(t, t.TempDir())
	api := declarationIdentityAPI(t)
	requireQuickfixTS593(t, api)
	seeds := quickfixBehaviorSeeds()
	for _, name := range []string{"EK4856-alias", "EK4856-channels", "EK4856-heritage"} {
		for _, choices := range [][]byte{{0}, {1}, {2}, {3, 1}} {
			t.Run(fmt.Sprintf("%s/%v", name, choices), func(t *testing.T) {
				files, code, native := quickfixBehaviorProgram(seeds, "EK4856@"+name, choices)
				if files == nil || code != 4856 || native {
					t.Fatal("missing executable legacy alias generator")
				}
				quickfixBehaviorCheck(t, w, binary, api, "EK4856", code, native, files)
			})
		}
	}
}

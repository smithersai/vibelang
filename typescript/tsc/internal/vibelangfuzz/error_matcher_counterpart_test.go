package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestErrorMatcherDeclarationCounterparts(t *testing.T) {
	quote := "published declarations add neither a"
	if !strings.Contains(SpecText("../vips/0027-declaration-output.md"), quote) {
		t.Fatal("VIP-27 published matcher ruling missing")
	}
	for _, name := range []string{"error-computed-payload-members", "declaration-identity-schema-error-fix", "declaration-identity-error"} {
		t.Run(name, func(t *testing.T) {
			archive, _ := declarationIdentityRegisteredFixture(t, name)
			CheckDeclarationIdentity(t, NewWorkspace(t), StockTypeScript(t), declarationIdentityAPI(t), archive)
		})
	}
}

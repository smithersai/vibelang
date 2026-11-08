package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestServiceAccessMigrationQuoted(t *testing.T) {
	TestCatchScopeFixQuoted(t)
	if !strings.Contains(SpecText("005-services.md"), "const users = try Users") {
		t.Fatal("review the service/reference migration controls against chapter5")
	}
}

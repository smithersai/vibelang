package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestGroupedSchemaInheritanceControlsQuoted(t *testing.T) {
	const quote = "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |"
	if !strings.Contains(SpecText("003-failures.md"), quote) {
		t.Fatal("inheritance boundary changed")
	}
	TestSchemaFactoryMigrationReturnsQuoted(t)
}

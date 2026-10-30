package vibelangmapper

import "testing"

func TestServicePlainMethodContracts(t *testing.T) {
	for _, source := range []string{
		"service Rates { lookup(): number }",
		"service Rates { lookup(): { base: string } }",
		"service Rates { lookup(): string | undefined }",
	} {
		for _, d := range Project(source, testContext).Diagnostics {
			if d.Code == 2101 {
				t.Fatalf("%s: %+v", source, d)
			}
		}
	}
}

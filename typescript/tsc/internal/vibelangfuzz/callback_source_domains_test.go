package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

// A declaration-only extension of the site generator must not turn a sibling
// implementation witness into a duplicate carrying a misleading "-dts" key.
func TestForeignCallbackSourceDomains(t *testing.T) {
	seenBounds := map[int]bool{}
	for _, source := range callbackImplementationSources {
		if source.declaration {
			t.Fatalf("implementation body cannot represent %s", source.name)
		}
		seenBounds[source.thrown] = true
	}
	for bound := range callbackBounds {
		if !seenBounds[bound] {
			t.Fatalf("missing implementation bound %s", callbackBounds[bound])
		}
	}
	for _, names := range [][]string{callbackAliasNames(), callbackElementNames()} {
		for _, name := range names {
			if strings.Contains(name, "-dts/") {
				t.Fatalf("declaration source leaked into implementation key %s", name)
			}
		}
	}
	names := callbackNames()
	for _, source := range []string{"never-dts", "error-dts"} {
		for _, destination := range callbackDestinations {
			for _, site := range callbackSites {
				name := source + "/" + destination.name + "/" + site.name
				if !slices.Contains(names, name) {
					t.Fatalf("lost declaration site witness %s", name)
				}
			}
		}
	}
}

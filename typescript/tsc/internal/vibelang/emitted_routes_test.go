package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/packagejson"
)

func TestEmittedRouteEntryPatterns(t *testing.T) {
	const root = "#vibelang/emitted/"
	for _, tc := range []struct {
		name               string
		keys               []string
		route, want, match string
	}{
		{"suffix after broad", []string{"*", "*.server"}, "user.server", "*.server", "user"},
		{"suffix before broad", []string{"*.server", "*"}, "user.server", "*.server", "user"},
		{"longer suffix", []string{"*.server", "*.special.server"}, "user.special.server", "*.special.server", "user"},
		{"longer prefix", []string{"*.server", "src/*"}, "src/user.server", "src/*", "user.server"},
		{"exact before pattern", []string{"*", "user.server"}, "user.server", "user.server", ""},
		{"empty suffix match", []string{"*.server"}, ".server", "", ""},
		{"empty trailing match", []string{"src/*"}, "src/", "", ""},
		{"overlapping prefix suffix", []string{"src/*server"}, "src/server", "", ""},
		{"nonempty trailing match", []string{"src/*"}, "src/u", "src/*", "u"},
		{"nested match", []string{"*"}, "a/b", "*", "a/b"},
		{"suffix mismatch", []string{"*.server"}, "user.client", "", ""},
		{"multiple key stars", []string{"*/*"}, "a/b", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			text := "{\"imports\":{"
			for i, key := range tc.keys {
				if i > 0 {
					text += ","
				}
				text += fmt.Sprintf("%q:%q", root+key, key)
			}
			fields, err := packagejson.Parse([]byte(text + "}}"))
			if err != nil {
				t.Fatal(err)
			}
			entry, match, found := emittedRouteEntry(fields.Imports.AsObject(), root+tc.route)
			if found != (tc.want != "") || match != tc.match {
				t.Fatalf("got found=%t match=%q, want found=%t match=%q", found, match, tc.want != "", tc.match)
			}
			if found && entry.AsString() != tc.want {
				t.Fatalf("selected %q, want %q", entry.AsString(), tc.want)
			}
		})
	}
}

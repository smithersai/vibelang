package modulespecifiers

import "testing"

func TestGeneratedExportSpecifierRespectsSelectedSubpath(t *testing.T) {
	for _, row := range []struct{ name, target, exports, want string }{
		{"private body", "/repo/lib/src/value.vibe.shapes.ts", `{"./*":"./src/*.ts","./value.vibe.shapes":null}`, ""},
		{"private body first", "/repo/lib/src/value.vibe.shapes.ts", `{"./value.vibe.shapes":null,"./*":"./src/*.ts"}`, ""},
		{"exact redirect", "/repo/lib/src/hidden.ts", `{"./*":"./src/*.ts","./hidden":"./src/public.ts"}`, ""},
		{"specific pattern blocked", "/repo/lib/src/private/value.ts", `{"./*":"./src/*.ts","./private/*":null}`, ""},
		{"pattern trailer blocked", "/repo/lib/src/private/value.ts", `{"./*":"./src/*.ts","./private/*value":null}`, ""},
		{"unmasked sibling", "/repo/lib/src/public.ts", `{"./*":"./src/*.ts","./hidden":null}`, "lib/public"},
		{"exact reopens pattern", "/repo/lib/src/private/value.ts", `{"./*":null,"./private/*":null,"./private/value":"./src/private/value.ts"}`, "lib/private/value"},
		{"specific pattern redirects", "/repo/lib/src/private/value.ts", `{"./*":"./src/*.ts","./private/*":"./other/*.ts"}`, ""},
	} {
		t.Run(row.name, func(t *testing.T) {
			if got := vibeExportName(t, row.target, row.exports); got != row.want {
				t.Fatalf("got %q want %q", got, row.want)
			}
		})
	}
}

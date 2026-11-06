package modulespecifiers

import "testing"

func TestNativeExportPrecedesSidecarWildcard(t *testing.T) {
	for _, row := range []struct{ name, target, exports, want string }{
		{"vibe exact after wildcard", "/repo/lib/src/Stage.vibe", `{"./*":"./src/*.ts","./Stage":"./src/Stage.vibe"}`, "lib/Stage"},
		{"vibex exact after wildcard", "/repo/lib/src/Stage.vibex", `{"./*":"./src/*.ts","./Stage":"./src/Stage.vibex"}`, "lib/Stage"},
		{"conditional source after types wildcard", "/repo/lib/src/Stage.vibe", `{"./*":{"types":"./src/*.ts"},"./Stage":{"vibelang-source":"./src/Stage.vibe"}}`, "lib/Stage"},
		{"vibex sidecar fallback", "/repo/lib/src/Stage.vibex", `{"./Stage":{"types":"./src/Stage.d.vibex.ts"}}`, "lib/Stage"},
		{"private module stays private", "/repo/lib/src/Hidden.vibe", `{"./Stage":"./src/Stage.vibe"}`, ""},
	} {
		t.Run(row.name, func(t *testing.T) {
			if got := vibeExportName(t, row.target, row.exports); got != row.want {
				t.Fatalf("got %q want %q", got, row.want)
			}
		})
	}
}

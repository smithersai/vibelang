package vibelangfuzz

import (
	"path/filepath"
	"testing"
)

func effectAliasStock(t testing.TB) string {
	t.Helper()
	path := declarationIdentityAPI(t)
	if packageVersion(path) != "5.9.3" {
		Missing(t, "Effect alias oracle requires stock tsc 5.9.3: install experiments' pinned TypeScript or set EFFECT_NODE_MODULES to an install containing typescript@5.9.3")
	}
	return filepath.Join(path, "bin/tsc")
}

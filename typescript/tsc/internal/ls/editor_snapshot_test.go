package ls_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// snapshotTestHost supplies converters for diagnostic and code-action requests.
type snapshotTestHost struct {
	ls.Host
	converters *lsconv.Converters
}

func (h snapshotTestHost) Converters() *lsconv.Converters { return h.converters }
func (h snapshotTestHost) GetPreferences(string) lsutil.UserPreferences {
	return lsutil.UserPreferences{}
}

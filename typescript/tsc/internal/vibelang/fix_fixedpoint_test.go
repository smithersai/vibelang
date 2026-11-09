// docs/design/vips/0034-compiler-and-tooling.md#8b7166d0d577488c
// VIP-34: fixed-point rerun, pass-limit residual report and driver exit status.
package vibelang

import (
	"bytes"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// Use the public driver, real project files and captured command streams so
// the pass-limit contract covers exit status and retained partial edits.
type fixLimitSystem struct {
	tsc.System
	fs          vfs.FS
	cwd         tspath.RootedDirectoryPath
	out, errors bytes.Buffer
}

func (s *fixLimitSystem) FS() vfs.FS                                     { return s.fs }
func (s *fixLimitSystem) DefaultLibraryPath() tspath.RootedDirectoryPath { return bundled.LibPath() }

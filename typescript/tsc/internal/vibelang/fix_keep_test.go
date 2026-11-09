package vibelang

import (
	"bytes"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// fixSys is the command line's system over fs, writing to buffers.
type fixSys struct {
	fs             vfs.FS
	cwd            string
	stdout, stderr bytes.Buffer
}

func (s *fixSys) FS() vfs.FS                                     { return s.fs }
func (s *fixSys) DefaultLibraryPath() tspath.RootedDirectoryPath { return bundled.LibPath() }
func (s *fixSys) Now() time.Time                                 { return time.Now() }

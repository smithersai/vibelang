// docs/design/vips/0034-compiler-and-tooling.md#8b7166d0d577488c
// VIP-34: fixed-point rerun, pass-limit residual report and driver exit status.
package vibelang

import (
	"bytes"
	"io"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// fixConfigOf parses the tsconfig.json beside name.
func fixConfigOf(t *testing.T, fs vfs.FS, name tspath.RootedFilePath) *tsoptions.ParsedCommandLine {
	t.Helper()
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(name.AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return config
}

// Use the public driver, real project files and captured command streams so
// the pass-limit contract covers exit status and retained partial edits.
type fixLimitSystem struct {
	tsc.System
	fs          vfs.FS
	cwd         tspath.RootedDirectoryPath
	out, errors bytes.Buffer
}

func (s *fixLimitSystem) FS() vfs.FS                                      { return s.fs }
func (s *fixLimitSystem) DefaultLibraryPath() tspath.RootedDirectoryPath  { return bundled.LibPath() }
func (s *fixLimitSystem) GetCurrentDirectory() tspath.RootedDirectoryPath { return s.cwd }
func (s *fixLimitSystem) Writer() io.Writer                               { return &s.out }
func (s *fixLimitSystem) ErrorWriter() io.Writer                          { return &s.errors }

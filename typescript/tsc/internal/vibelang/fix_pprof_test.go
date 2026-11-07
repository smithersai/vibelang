package vibelang

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// --pprofDir profiles a --fix run itself, in dir/fix. On a large project the
// repair's checks are most of the run, and without its own profile only the
// compile after it was measured.
func TestFixWritesPprofProfilesOfTheRepair(t *testing.T) {
	project := keepProject(t)
	profiles := t.TempDir()
	sys := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: project}
	if status := FixWithOptions(t.Context(), sys, []string{"-p", project, "--pprofDir", profiles}, FixOptions{ProgressEvery: time.Hour}); status != 0 {
		t.Fatalf("status %d, stderr %q", status, sys.stderr.String())
	}
	for _, kind := range []string{"cpuprofile", "memprofile"} {
		found, err := filepath.Glob(filepath.Join(profiles, "fix", "*-"+kind+".pb.gz"))
		if err != nil || len(found) != 1 {
			t.Fatalf("%s profiles in %s/fix: %v, %v; stderr %q", kind, profiles, found, err, sys.stderr.String())
		}
	}
}

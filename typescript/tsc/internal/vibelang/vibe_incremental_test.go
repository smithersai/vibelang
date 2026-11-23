package vibelang

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/execute"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

type vibeTestSys struct {
	fs    vfs.FS
	cwd   tspath.RootedDirectoryPath
	out   bytes.Buffer
	err   bytes.Buffer
	start time.Time
}

func (s *vibeTestSys) Writer() io.Writer                                 { return &s.out }
func (s *vibeTestSys) ErrorWriter() io.Writer                            { return &s.err }
func (s *vibeTestSys) FS() vfs.FS                                        { return s.fs }
func (s *vibeTestSys) DefaultLibraryPath() tspath.RootedDirectoryPath    { return bundled.LibPath() }
func (s *vibeTestSys) GetCurrentDirectory() tspath.RootedDirectoryPath   { return s.cwd }
func (s *vibeTestSys) WriteOutputIsTTY() bool                            { return false }
func (s *vibeTestSys) GetWidthOfTerminal() int                           { return 80 }
func (s *vibeTestSys) GetEnvironmentVariable(name string) (string, bool) { return "", false }
func (s *vibeTestSys) Spawn([]string, string, io.Writer) (io.ReadWriteCloser, error) {
	return nil, io.EOF
}
func (s *vibeTestSys) Now() time.Time            { return time.Now() }
func (s *vibeTestSys) SinceStart() time.Duration { return time.Since(s.start) }

func runVibeCLI(t *testing.T, dir string, args ...string) (tsc.ExitStatus, string) {
	t.Helper()
	sys := &vibeTestSys{
		fs:    bundled.WrapFS(osvfs.FS()),
		cwd:   tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(dir)),
		start: time.Now(),
	}
	res := execute.CommandLine(t.Context(), sys, args, nil)
	return res.Status, sys.out.String() + sys.err.String()
}

func TestIncrementalBuildInfoTracksVibeSettings(t *testing.T) {
	source := "export effect function main() { try sleep(\"1 millis\"); return 1 }\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())

	// Case (a): removing vibe.effectGlobals: false must invalidate cached TS2304.
	cfgWithVibe := `{
		"compilerOptions": {
			"target": "ES2022",
			"module": "NodeNext",
			"strict": true,
			"skipLibCheck": true,
			"incremental": true,
			"tsBuildInfoFile": "./cache.tsbuildinfo",
			"outDir": "./out"
		},
		"vibe": { "effectGlobals": false },
		"files": ["main.vibe"]
	}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfgWithVibe), 0600); err != nil {
		t.Fatal(err)
	}
	status1, out1 := runVibeCLI(t, dir)
	if status1 == tsc.ExitStatusSuccess || !strings.Contains(out1, "TS2304") {
		t.Fatalf("expected TS2304 with effectGlobals:false, got status=%v:\n%s", status1, out1)
	}

	cfgWithoutVibe := `{
		"compilerOptions": {
			"target": "ES2022",
			"module": "NodeNext",
			"strict": true,
			"skipLibCheck": true,
			"incremental": true,
			"tsBuildInfoFile": "./cache.tsbuildinfo",
			"outDir": "./out"
		},
		"files": ["main.vibe"]
	}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfgWithoutVibe), 0600); err != nil {
		t.Fatal(err)
	}
	status2, out2 := runVibeCLI(t, dir)
	if status2 != tsc.ExitStatusSuccess || strings.Contains(out2, "TS2304") {
		t.Fatalf("expected clean incremental rebuild after removing vibe section, got status=%v:\n%s", status2, out2)
	}
}

func TestIncrementalBuildReusesUnchangedVibeSettings(t *testing.T) {
	source := "export effect function main() { return 1 }\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())

	cfg := `{
		"compilerOptions": {
			"target": "ES2022",
			"module": "NodeNext",
			"strict": true,
			"skipLibCheck": true,
			"declaration": true,
			"incremental": true,
			"listEmittedFiles": true,
			"tsBuildInfoFile": "./cache.tsbuildinfo",
			"outDir": "./out"
		},
		"vibe": { "effectModules": true },
		"files": ["main.vibe"]
	}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfg), 0600); err != nil {
		t.Fatal(err)
	}
	status1, out1 := runVibeCLI(t, dir)
	if status1 != tsc.ExitStatusSuccess {
		t.Fatalf("first build failed: status=%v\n%s", status1, out1)
	}
	if !strings.Contains(out1, "main.d.vibe.ts") {
		t.Fatalf("expected --listEmittedFiles to list declaration sidecar main.d.vibe.ts, got:\n%s", out1)
	}

	status2, out2 := runVibeCLI(t, dir)
	if status2 != tsc.ExitStatusSuccess {
		t.Fatalf("second build failed: status=%v\n%s", status2, out2)
	}
	if strings.Contains(out2, "TSFILE:") {
		t.Fatalf("expected incremental hit with unchanged vibe section (no emitted files), got:\n%s", out2)
	}
}

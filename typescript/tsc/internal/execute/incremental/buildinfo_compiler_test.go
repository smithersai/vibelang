package incremental_test

import (
	"os"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/execute/incremental"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"gotest.tools/v3/assert"
)

// foldkit-123: two VibeLang compilers report the same TypeScript version, so
// the version alone let one reuse the other's cached check. A build info
// names the compiler build that wrote it, and only that build reuses it.
func TestBuildInfoFromAnotherCompilerBuildIsNotReused(t *testing.T) {
	t.Parallel()
	current := incremental.CompilerBuild()
	assert.Assert(t, current != "", "the test binary has a Go build ID")
	for _, c := range []struct {
		compiler string
		valid    bool
	}{
		{current, true},
		{"another-build/abc", false},
		{"", false}, // written by a compiler that recorded no build
	} {
		buildInfo := &incremental.BuildInfo{Version: core.Version(), Compiler: c.compiler, FileNames: []incremental.BuildInfoPath{"/src/a.ts"}}
		assert.Equal(t, buildInfo.IsValidVersion(), c.valid, "compiler %q", c.compiler)
		if !c.valid {
			host := compiler.NewCompilerHost(vfstest.FromMap[any](nil, tspath.CaseSensitive), "", nil, nil, nil)
			program := incremental.ReadBuildInfoProgram(configWithMappers(), fakeBuildInfoReader{buildInfo}, host)
			assert.Assert(t, program == nil, "compiler %q: a cached program from another build must be discarded", c.compiler)
		}
	}
	// A different TypeScript version stays invalid whatever the build.
	assert.Assert(t, !(&incremental.BuildInfo{Version: "0.0.0", Compiler: current}).IsValidVersion())
}

func TestCompilerBuildIsTheBinaryGoBuildID(t *testing.T) {
	t.Parallel()
	exe, err := os.Executable()
	assert.NilError(t, err)
	assert.Equal(t, incremental.CompilerBuild(), incremental.GoBuildIDForTest(exe))
	assert.Equal(t, incremental.CompilerBuild(), incremental.CompilerBuild(), "stable within a process")
	text := t.TempDir() + "/plain.txt"
	assert.NilError(t, os.WriteFile(text, []byte("not a Go binary"), 0o644))
	assert.Equal(t, incremental.GoBuildIDForTest(text), "")
	assert.Equal(t, incremental.GoBuildIDForTest(t.TempDir()+"/missing"), "")
}

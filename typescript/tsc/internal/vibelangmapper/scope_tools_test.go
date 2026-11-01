package vibelangmapper

import (
	"os"
	"path/filepath"
	"testing"

	"gotest.tools/v3/assert"
)

func lookupIn(values map[string]string) func(string) string {
	return func(name string) string { return values[name] }
}

// TestScopeToolSource keeps the handover contract: an unset variable links the
// tool, a set one must name an executable file and is used as is.
func TestScopeToolSource(t *testing.T) {
	source, err := scopeToolSource("tsc", lookupIn(nil))
	assert.NilError(t, err)
	assert.Equal(t, source, "")

	dir := t.TempDir()
	exe := filepath.Join(dir, "tsc")
	assert.NilError(t, os.WriteFile(exe, []byte("#!/bin/sh\n"), 0o755))
	source, err = scopeToolSource("tsc", lookupIn(map[string]string{"VIBELANG_MAPPER_TEST_TSC": exe}))
	assert.NilError(t, err)
	assert.Equal(t, source, exe)

	_, err = scopeToolSource("vibelang-mapper", lookupIn(map[string]string{"VIBELANG_MAPPER_TEST_MAPPER": filepath.Join(dir, "missing")}))
	assert.ErrorContains(t, err, "VIBELANG_MAPPER_TEST_MAPPER="+filepath.Join(dir, "missing"))

	plain := filepath.Join(dir, "plain")
	assert.NilError(t, os.WriteFile(plain, nil, 0o644))
	_, err = scopeToolSource("vibelang-mapper", lookupIn(map[string]string{"VIBELANG_MAPPER_TEST_MAPPER": plain}))
	assert.ErrorContains(t, err, "not an executable file")
}

// TestProvideScopeToolUsesPrebuilt proves the scope runs the named executable
// without a build: a shell script could not have come out of go build.
func TestProvideScopeToolUsesPrebuilt(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "prebuilt-tsc")
	assert.NilError(t, os.WriteFile(exe, []byte("#!/bin/sh\necho prebuilt\n"), 0o755))
	t.Setenv("VIBELANG_MAPPER_TEST_TSC", exe)
	scope := filepath.Join(dir, "scope")
	assert.NilError(t, os.MkdirAll(filepath.Join(scope, "bin"), 0o700))
	assert.NilError(t, provideScopeTool("/nonexistent-root", scope, "tsc"))
	target, err := os.Readlink(filepath.Join(scope, "bin", "tsc"))
	assert.NilError(t, err)
	assert.Equal(t, target, exe)

	t.Setenv("VIBELANG_MAPPER_TEST_TSC", filepath.Join(dir, "gone"))
	err = provideScopeTool("/nonexistent-root", filepath.Join(dir, "scope2"), "tsc")
	assert.ErrorContains(t, err, "VIBELANG_MAPPER_TEST_TSC=")
}

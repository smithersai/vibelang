package tsoptions_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"gotest.tools/v3/assert"
	"testing"
)

func TestRawVibeParsedOptionsRoundTrip(t *testing.T) {
	for _, severity := range []string{"error", "warning", "suggestion", "off"} {
		t.Run(severity, func(t *testing.T) {
			config := vibeConfig(t, `{"compilerOptions":{"strict":true,"noEmitOnError":true,"outDir":"dist"},"vibe":{"effectGlobals":false,"effectModules":false,"sidecarDir":".vibe/declarations","severities":{"EK4855":"`+severity+`"}},"files":["main.vibe"]}`, "{}")
			assert.Equal(t, len(config.Errors), 0)
			// Include the supported legacy API field and the retired trustedPackages
			// field, which must grant no trust through the API path.
			config.CompilerOptions().VibeLang.TrustedPackages = []string{"@app/*"}
			config.CompilerOptions().VibeLang.Diagnostics = map[string]string{"EK9204": "off"}
			encoded, err := json.Marshal(config.CompilerOptions())
			assert.NilError(t, err)
			var raw tsoptions.RawCompilerOptions
			assert.NilError(t, json.Unmarshal(encoded, &raw))
			got, diags := raw.Finalize(tspath.RootedDirectoryPath("/project"))
			assert.Equal(t, len(diags), 0)
			assert.Assert(t, got.VibeLang != nil, "API lost parsed options: %s", encoded)
			want := config.CompilerOptions().VibeLang
			assert.DeepEqual(t, got.VibeLang.Severities, want.Severities)
			assert.DeepEqual(t, got.VibeLang.Diagnostics, want.Diagnostics)
			assert.Equal(t, len(got.VibeLang.TrustedPackages), 0, "retired trustedPackages survived the API path: %v", got.VibeLang.TrustedPackages)
			assert.Equal(t, got.VibeLang.EffectGlobals, core.TSFalse)
			assert.Equal(t, got.VibeLang.EffectModules, core.TSFalse)
			assert.Equal(t, got.VibeLang.SidecarDir, "/project/.vibe/declarations")
			assert.Equal(t, got.Strict, core.TSTrue)
			assert.Equal(t, got.NoEmitOnError, core.TSTrue)
			assert.Equal(t, got.OutDir, tspath.RootedDirectoryPath("/project/dist"))
		})
	}
}

func TestRawVibeRetiredTrustedPackagesGrantNoTrust(t *testing.T) {
	var raw tsoptions.RawCompilerOptions
	assert.NilError(t, json.Unmarshal([]byte(`{"vibelang":{"trustedPackages":["zod"]}}`), &raw))
	got, _ := raw.Finalize(tspath.RootedDirectoryPath("/project"))
	assert.Assert(t, got.VibeLang != nil)
	assert.Equal(t, len(got.VibeLang.TrustedPackages), 0, "retired trustedPackages survived the API path: %v", got.VibeLang.TrustedPackages)
}

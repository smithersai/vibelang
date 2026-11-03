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
			// Include the supported legacy API fields as well as modern config fields.
			config.CompilerOptions().VibeLang.TrustedPackages = []string{"@app/*"}
			config.CompilerOptions().VibeLang.DeclarationImportStyle = ".ts"
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
			assert.DeepEqual(t, got.VibeLang.TrustedPackages, want.TrustedPackages)
			assert.Equal(t, got.VibeLang.DeclarationImportStyle, ".ts")
			assert.Equal(t, got.VibeLang.EffectGlobals, core.TSFalse)
			assert.Equal(t, got.VibeLang.EffectModules, core.TSFalse)
			assert.Equal(t, got.VibeLang.SidecarDir, "/project/.vibe/declarations")
			assert.Equal(t, got.Strict, core.TSTrue)
			assert.Equal(t, got.NoEmitOnError, core.TSTrue)
			assert.Equal(t, got.OutDir, tspath.RootedDirectoryPath("/project/dist"))
		})
	}
}

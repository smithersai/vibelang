package api

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/testutil/projecttestutil"
	"gotest.tools/v3/assert"
	"testing"
)

func TestAPIProgramVibeOptions(t *testing.T) {
	ps, _ := projecttestutil.Setup(map[string]any{"/home/projects/p/main.vibe": "export const x = 1;"})
	defer ps.Close()
	s := NewLSPSession(ps, nil)
	defer s.Close()
	for _, severity := range []string{"error", "off", "suggestion", "warning"} {
		var changes SnapshotRequestChangesParams
		assert.NilError(t, json.Unmarshal([]byte(`{"createPrograms":[{"rootFiles":["/home/projects/p/main.vibe"],"compilerOptions":{"strict":true,"noEmitOnError":true,"vibelang":{"effectModules":false,"effectGlobals":false,"severities":{"EK4855":"`+severity+`"}}}}],"reconfigurePrograms":[{"id":"/dev/null/synthetic/1","rootFiles":["/home/projects/p/main.vibe"],"compilerOptions":{"strict":true,"vibelang":{"severities":{"EK4855":"`+severity+`"}}}}]}`), &changes))
		r, err := s.toAPISnapshotRequest(context.Background(), &changes)
		assert.NilError(t, err)
		a, b := r.CreatePrograms[0].CompilerOptions, r.ReconfigurePrograms[0].CompilerOptions
		assert.Assert(t, a.VibeLang != nil, "create lost options")
		assert.Assert(t, b.VibeLang != nil, "reconfigure lost options")
		assert.Equal(t, a.VibeLang.Severities["EK4855"], severity)
		assert.Equal(t, b.VibeLang.Severities["EK4855"], severity)
		assert.Equal(t, a.VibeLang.EffectModules, core.TSFalse)
		assert.Equal(t, a.VibeLang.EffectGlobals, core.TSFalse)
		assert.Equal(t, a.NoEmitOnError, core.TSTrue)
		assert.Equal(t, b.Strict, core.TSTrue)
	}
}

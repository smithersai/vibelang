package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
	"os"
	"path/filepath"
	"testing"
)

func TestVIPProducerEffectCopies(t *testing.T) {
	env := newVIPEnv(t)
	source, err := filepath.EvalSymlinks(filepath.Join(env.w.Dir, "node_modules/effect"))
	if err != nil {
		t.Fatal(err)
	}
	peer := filepath.Join(env.w.Dir, "node_modules/vibelang-runtime/node_modules/effect")
	if err := os.MkdirAll(filepath.Dir(peer), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.CopyFS(peer, os.DirFS(source)); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"vip21.producer", "vip21.project-effect-instance"} {
		t.Run(key, func(t *testing.T) {
			program := vipgen.Probe(key)
			failures := env.run(t, program).failures()
			gaps := &vipGaps{t: t}
			for _, key := range mapKeys(failures) {
				gaps.add(key, program, failures[key])
			}
			gaps.finish("")
		})
	}
}

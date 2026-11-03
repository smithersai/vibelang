package vibelang

import (
	"strings"
	"testing"
)

func TestFixEffectGenKeepsFactoryBinding(t *testing.T) {
	source := "import * as Effect from \"effect/Effect\"\ndeclare function make(): Effect.Effect<number>\nexport const build = () => Effect.gen(function* () {\n  const operation = make()\n  return yield* operation\n})\n"
	result, name := fixSourceOptions(t, source, FixOptions{})
	fixed := result.Files[name]
	if result.Err != nil || fixed == nil || !strings.Contains(fixed.Text, "const operation = make()") {
		t.Fatalf("a held factory must construct at its original binding: fixed=%+v refused=%+v err=%v", fixed, result.Refused, result.Err)
	}
}

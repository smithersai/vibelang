package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const optionalEffectGuardQuote = "A statically non-Effect or possibly `undefined` operand is `EK0502`"

func TestOptionalEffectGuardsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), optionalEffectGuardQuote) {
		t.Fatal("VIP-5 optional operand rule changed")
	}
}

func FuzzOptionalEffectGuards(f *testing.F) {
	startShortBudget(f)
	keys := []string{"call", "method", "receiver", "both", "computed", "value"}
	for _, key := range keys {
		for variant := uint8(0); variant < 2; variant++ {
			f.Add(key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestOptionalEffectGuardsQuoted(t)
		operands := map[string]string{"call": "callback?.()", "method": "required.run?.()", "receiver": "receiver?.run()", "both": "optional?.run?.()", "computed": `optional?.["run"]?.()`, "value": "pending"}
		operand, ok := operands[key]
		if !ok {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
			operand = operands[key]
		}
		guarded := variant&1 != 0
		body := "return try program"
		if guarded {
			body = "return program === undefined ? undefined : try program"
		}
		source := `import * as Effect from "effect/Effect"
declare const callback: (() => Effect.Effect<number>) | undefined
declare const required: { run?: () => Effect.Effect<number> }
declare const receiver: { run: () => Effect.Effect<number> } | undefined
declare const optional: { run?: () => Effect.Effect<number> } | undefined
declare const pending: Effect.Effect<number> | undefined
export effect function probe(): Effect.Effect<number | undefined> { const program = ` + operand + `; ` + body + ` }`
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var errors []string
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, diagnosticCodeName(d.Source(), d.Code()))
			}
		}
		valid := guarded && len(errors) == 0 || !guarded && len(errors) == 1 && errors[0] == "EK0502"
		if !valid {
			Gap(t, "FuzzOptionalEffectGuards", fmt.Sprintf("optional:%s:%d", key, variant&1), "VIP-5: %s; guarded=%t; errors=%v\n%s", optionalEffectGuardQuote, guarded, errors, source)
		}
	})
}

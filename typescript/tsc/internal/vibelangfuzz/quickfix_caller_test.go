package vibelangfuzz

import (
	"testing"
)

// A knockout proof for each observable that the Effect-only export selector
// previously missed. All baselines are valid native TypeScript.
func TestQuickFixCallerObserves(t *testing.T) {
	w := NewWorkspace(t)
	for _, pair := range []struct{ name, a, b string }{
		{"effect-value", "import { Effect } from \"effect\"; export const main=Effect.succeed(7)", "import { Effect } from \"effect\"; export const main=Effect.succeed(8)"},
		{"effect-failure", "import { Effect } from \"effect\"; export function main(){return Effect.fail({id:7})}", "import { Effect } from \"effect\"; export function main(){return Effect.fail({id:8})}"},
		{"plain", "export function main(){return 7}", "export function main(){return 8}"},
		{"promise", "export async function main(){return 7}", "export async function main(){return 8}"},
		{"generator-throw-prefix", "export function* main(){yield 1;throw {id:7}}", "export function* main(){yield 2;throw {id:7}}"},
		{"generator-return", "export function* main(){yield 1;return 7}", "export function* main(){yield 1;return 8}"},
		{"throw", "export function main(){throw {id:7}}", "export function main(){throw {id:8}}"},
		{"order", "let trace:number[]=[]; export const traceOf=()=>trace; export function main(){trace.push(1,2);return 7}", "let trace:number[]=[]; export const traceOf=()=>trace; export function main(){trace.push(2,1);return 7}"},
	} {
		t.Run(pair.name, func(t *testing.T) {
			a := toolsCompile(t, w, quickfixBehaviorTarget, map[string]string{"main.ts": pair.a})
			defer a.Remove()
			b := toolsCompile(t, w, quickfixBehaviorTarget, map[string]string{"main.ts": pair.b})
			defer b.Remove()
			if !toolsErrorFree(a) || !toolsErrorFree(b) {
				t.Fatal("invalid native control")
			}
			entry := toolsRunnable{"out/main.js", "main"}
			original := quickfixCaller(t, w, a, entry)
			repeated := quickfixCaller(t, w, a, entry)
			changed := quickfixCaller(t, w, b, entry)
			if toolsInvalidOutcome(original) || toolsInvalidOutcome(changed) {
				t.Fatalf("invalid outcomes: %+v %+v", original, changed)
			}
			if !toolsSameOutcome(original, repeated) {
				t.Fatal("identical original differs")
			}
			if toolsSameOutcome(original, changed) {
				t.Fatalf("observer missed %s: %+v %+v", pair.name, original, changed)
			}
		})
	}
}

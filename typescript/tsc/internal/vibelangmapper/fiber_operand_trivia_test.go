package vibelangmapper

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFiberOperandTriviaProjection(t *testing.T) {
	forms := []struct{ name, prefix string }{
		{"child", "fork"}, {"in", "fork.in(s)"}, {"scoped", "fork.scoped"}, {"detached", "fork.detached"},
	}
	gaps := []string{"\n", "\r\n", "\u2028", "\u2029", "/*\n*/", "// operand\n"}
	bodies := []struct{ name, before, after string }{
		{"function", "export effect function sample(s, e) { ", " }"},
		{"arrow", "export const sample = effect (s, e) => { ", " }"},
		{"block", "export const sample = effect { const s = null, e = null; ", " }"},
		{"method", "export class C { effect sample(s, e) { ", " } }"},
	}
	for _, form := range forms {
		for _, body := range bodies {
			for _, gap := range gaps {
				t.Run(form.name+"/"+body.name+"/"+strings.ReplaceAll(gap, "\n", "LF"), func(t *testing.T) {
					contents := func(trivia string) string {
						return body.before + "const f = " + form.prefix + trivia + "e; return join" + trivia + "f" + body.after
					}
					source, canonical := contents(gap), contents(" ")
					for _, render := range []func(string, FileContext) Projection{Project, Executable} {
						got, want := render(source, testContext), render(canonical, testContext)
						if len(want.Diagnostics) != 0 {
							t.Fatalf("invalid test control: %v\n%s", want.Diagnostics, want.Text)
						}
						if len(got.Diagnostics) != 0 || got.Text != want.Text {
							t.Fatalf("line breaks must keep the same fiber operation: %v\n%s\nwant:\n%s", got.Diagnostics, got.Text, want.Text)
						}
						assertValidMap(t, got, source)
						assertParses(t, got.Text)
					}
				})
			}
		}
	}
}

func TestFiberOperandTriviaPlainHelpers(t *testing.T) {
	const source = "export effect function sample() { function plain() { const fork = { scoped: 1 }; const join = 2; fork.scoped\njoin; return join }; return plain() }"
	for _, render := range []func(string, FileContext) Projection{Project, Executable} {
		got := render(source, testContext)
		if len(got.Diagnostics) != 0 || !strings.Contains(got.Text, "fork.scoped\njoin") {
			t.Fatalf("ordinary nested helper names must keep their source reading: %v\n%s", got.Diagnostics, got.Text)
		}
		assertValidMap(t, got, source)
		assertParses(t, got.Text)
	}
}

func TestFiberOperandTriviaRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	for _, form := range []struct{ name, operation, native string }{
		{"child", "fork", "NativeEffect.forkChild(NativeEffect.succeed(7))"},
		{"in", "fork.in(s)", "NativeEffect.forkIn(NativeEffect.succeed(7), s)"},
		{"scoped", "fork.scoped", "NativeEffect.forkScoped(NativeEffect.succeed(7))"},
		{"detached", "fork.detached", "NativeEffect.forkDetach(NativeEffect.succeed(7))"},
	} {
		t.Run(form.name, func(t *testing.T) {
			source := "import { Effect } from 'effect'; export effect function scenario(s) { const f = " + form.operation + "// operand\nEffect.succeed(7); return join/*\n*/f }"
			js, _, diagnostics := Emit(source, testContext)
			if len(diagnostics) != 0 {
				t.Fatalf("unexpected diagnostics: %v\n%s", diagnostics, js)
			}
			counterpart := "function scenario(s) { return NativeEffect.gen(function* () { const f = yield* " + form.native + "; return yield* NativeFiber.join(f) }) }"
			runner := "\nimport * as NativeEffect from 'effect/Effect'; import * as NativeFiber from 'effect/Fiber'; const result = await NativeEffect.runPromise(NativeEffect.scoped(NativeEffect.gen(function* () { const s = yield* NativeEffect.scope; return yield* scenario(s) }))); console.log(JSON.stringify(result))"
			for _, program := range []string{js, counterpart} {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				cmd := exec.CommandContext(ctx, node, "--no-warnings", "--input-type=module")
				cmd.Dir = scope
				cmd.Stdin = strings.NewReader(program + runner)
				output, err := cmd.CombinedOutput()
				if err != nil || strings.TrimSpace(string(output)) != "7" {
					t.Fatalf("fork/join must match native Effect: %v; output %s\n%s", err, output, program)
				}
			}
		})
	}
}

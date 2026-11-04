package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestIterablePatternCacheBodyProjection(t *testing.T) {
	for _, source := range []string{
		"export function scenario(xs: unknown): number { if (xs is [let n,...]) return n as number; return 0 }",
		"export effect function scenario(xs: unknown) { if (xs is [let n,...]) return n; return 0 }",
		"export const scenario = (xs: unknown): number => { if (xs is [let n,...]) return n as number; return 0 }",
		"export effect function scenario(xs: unknown) { { if (xs is [let n,...]) return n; } return 0 }",
		"export effect function scenario(xs: unknown, ys: unknown) { if (xs is [let n,...]) { if (ys is [let m,...]) return [n,m]; } return [] }",
	} {
		for name, result := range map[string]Projection{"checking": Project(source, testContext), "executable": Executable(source, testContext)} {
			if len(result.Diagnostics) != 0 {
				t.Errorf("%s: %v\n%s", name, result.Diagnostics, result.Text)
			}
			if !strings.Contains(result.Text, "$matchCache") {
				t.Errorf("%s lost iterator cache: %s", name, result.Text)
			}
			assertValidMap(t, result, source)
		}
	}
}

func TestIterablePatternCacheBodyRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, source, invoke, want string }{
		{"plain-return", "export function scenario(xs: unknown): number { if (xs is [let n,...]) return n as number; return 0 }", "scenario(values())", "[7,[\"open\",\"close\"]]"},
		{"effect-return", "export effect function scenario(xs: unknown) { if (xs is [let n,...]) return n; return 0 }", "await E.runPromise(scenario(values()))", "[7,[\"open\",\"close\"]]"},
		{"failed-pattern", "export effect function scenario(xs: unknown) { if (xs is [9,...let rest]) return rest.length; return -1 }", "await E.runPromise(scenario(values()))", "[-1,[\"open\",\"close\"]]"},
		{"cache-name-collision", "export function scenario(xs: unknown): number[] { const $matchCache2 = 9; if (xs is [let n,...]) return [n as number,$matchCache2]; return [] }", "scenario(values())", "[[7,9],[\"open\",\"close\"]]"},
		{"throwing-pattern", "export effect function scenario(xs: unknown) { if (xs is [{id:let n},...]) return n; return 0 }", "await E.runPromiseExit(scenario(throwingValues())).then(exit => exit._tag)", "[\"Failure\",[\"open\",\"close\"]]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			js, _, diagnostics := Emit(tc.source, testContext)
			if len(diagnostics) != 0 {
				t.Fatalf("%v\n%s", diagnostics, js)
			}
			runner := "\nimport * as E from 'effect/Effect'; const events=[]; function* values(){events.push('open');try{yield 7;yield 8}finally{events.push('close')}}; function* throwingValues(){events.push('open');try{yield {get id(){throw new Error('sentinel')}};yield 8}finally{events.push('close')}}; console.log(JSON.stringify([" + tc.invoke + ",events]));"
			cmd := exec.Command(node, "--no-warnings", "--input-type=module")
			cmd.Dir = scope
			cmd.Stdin = strings.NewReader(js + runner)
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("%v\n%s\n%s", err, out, js)
			}
			if strings.TrimSpace(string(out)) != tc.want {
				t.Errorf("got %s; want %s", out, tc.want)
			}
		})
	}
}

package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// TestPlainFunctionStopsAtItsOwnBody checks that deciding whether a function
// compiles to plain JavaScript does not explore its callees when its own body
// already rules it out. Each unannotated function of a chain throws outside a try and
// calls the previous one; asking about the last must decide only the last.
// Exploring the callees anyway made the language server's first hover in a
// module analyze every function the call graph reached.
func TestPlainFunctionStopsAtItsOwnBody(t *testing.T) {
	t.Parallel()
	const count = 50
	var source strings.Builder
	for i := range count {
		result := "x"
		if i > 0 {
			result = fmt.Sprintf("f%d(x - 1)", i-1)
		}
		fmt.Fprintf(&source, "export function f%d(x: number) {\n  if (x < 0) throw new Error(\"negative\")\n  return %s\n}\n", i, result)
	}
	fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(map[string]string{
		"/chain.vibe":    source.String(),
		"/tsconfig.json": `{ "compilerOptions": { "strict": true }, "files": ["chain.vibe"] }`,
	}), tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("tsconfig: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	p.BindSourceFiles()
	c, done := p.GetTypeChecker(t.Context())
	defer done()
	last := p.GetSourceFile("/chain.vibe").Statements.Nodes[count-1]
	a := analyzerFor(c)
	if a.isPlainFunction(last) {
		t.Fatalf("f%d throws outside a try, so it cannot compile to plain JavaScript", count-1)
	}
	if len(a.plain) != 1 {
		t.Errorf("deciding f%d decided %d functions; its own throw rules it out, so only it needs a verdict", count-1, len(a.plain))
	}
}

// A plain contract supplied by an interface or an object's context never
// fails (D282): a method there that throws is EK4301, and its explicitly
// plain callback parameter infers no Effect.
func TestInferredPlainMethodContract(t *testing.T) {
	t.Parallel()
	fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(map[string]string{
		"/main.vibe": `interface Plain { call(build: (payload: string) => string): string }
export class Impl implements Plain {
  call(build: (payload: string) => string) {
    if (!build) throw new Error("empty")
    return build("x")
  }
}
export const object: Plain = {
  call(build) {
    if (!build) throw new Error("empty")
    return build("x")
  }
}
`,
		"/tsconfig.json": `{ "compilerOptions": { "strict": true }, "files": ["main.vibe"] }`,
	}), tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("tsconfig: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	var failing []string
	for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
		switch d.Code() {
		case EK4301.Code:
			failing = append(failing, d.String())
		case EK4804.Code:
			// a global Error has no _tag (lsrules.go)
		case EK1011.Code:
			// the program has no effect package to type the throwing methods (effectavailable.go)
		default:
			t.Errorf("plain contract diagnostic: %s", d.String())
		}
	}
	if len(failing) != 2 {
		t.Fatalf("EK4301 at %d methods, want both: %v", len(failing), failing)
	}
	for _, text := range failing {
		if !strings.Contains(text, "call can't throw Error: Plain declares it as a plain function, which never fails.") && !strings.Contains(text, "call can't throw Error: its contextual type declares it as a plain function, which never fails.") {
			t.Errorf("EK4301 text: %s", text)
		}
	}
}

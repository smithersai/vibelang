package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func durableCapDiagnostics(t *testing.T, source string, vibeConfig string) []*ast.Diagnostic {
	t.Helper()
	if vibeConfig == "" {
		vibeConfig = `{"experimental":["builtins"]}`
	}
	config := strings.TrimSuffix(editorTsconfig, "}") + `,"vibe":` + vibeConfig + `}`
	program, file, _, _ := editorProgramConfig(t, source, editorPackageJSON, editorPackages, config)
	return program.GetSemanticDiagnostics(t.Context(), file)
}

func TestDurableStaticTierCapabilitiesEffectsValid(t *testing.T) {
	source := strings.Join([]string{
		`task ReadDoc {`,
		`  static readonly tier = "sealed"`,
		`  static readonly capabilities = ["fs:read:/workspace/**", { action: "net:get", resource: "https://api.github.com/**" }]`,
		`  static readonly effects = { reads: ["fs:read:/workspace/**"], writes: [] }`,
		`  effect call(path: string): string!string { return path }`,
		`}`,
		`task EditDoc {`,
		`  static readonly tier = "compensable"`,
		`  static readonly capabilities = ["fs:write:/workspace/**"]`,
		`  static readonly effects = ["fs:write"]`,
		`  effect call(path: string): void!string {}`,
		`}`,
		`task Isolated {`,
		`  static readonly tier = "irreversible"`,
		`  static readonly capabilities = []`,
		`  effect call(id: string): number!never { return id.length }`,
		`}`,
		`export workflow Pipeline {`,
		`  static readonly tier = "irreversible"`,
		`  static readonly capabilities = ["*"]`,
		`  static readonly effects = { reads: ["fs:read"], writes: ["fs:write:/workspace/**"] }`,
		`  effect call(path: string): number!string {`,
		`    const doc = try ReadDoc(path)`,
		`    try EditDoc(doc)`,
		`    return try Isolated(doc)`,
		`  }`,
		`}`,
		`export const P = Pipeline.plan`,
		``,
	}, "\n")
	for _, d := range durableCapDiagnostics(t, source, "") {
		t.Fatalf("unexpected diagnostic: %s", d.String())
	}
}

func TestDurableStaticTierCapabilitiesEffectsInvalid(t *testing.T) {
	cases := []struct {
		name   string
		source string
	}{
		{
			name: "task invalid tier",
			source: strings.Join([]string{
				`task BadTier {`,
				`  static readonly tier = "ephemeral"`,
				`  effect call(id: string): string!never { return id }`,
				`}`,
			}, "\n"),
		},
		{
			name: "workflow invalid tier",
			source: strings.Join([]string{
				`workflow BadWorkflowTier {`,
				`  static readonly tier = "unknown"`,
				`  effect call(id: string): string!never { return id }`,
				`}`,
			}, "\n"),
		},
		{
			name: "task unknown capability action",
			source: strings.Join([]string{
				`task BadCapAction {`,
				`  static readonly capabilities = ["bogus:op:/workspace/**"]`,
				`  effect call(id: string): string!never { return id }`,
				`}`,
			}, "\n"),
		},
		{
			name: "task capability missing resource",
			source: strings.Join([]string{
				`task BadCapMissingResource {`,
				`  static readonly capabilities = ["fs:read"]`,
				`  effect call(id: string): string!never { return id }`,
				`}`,
			}, "\n"),
		},
		{
			name: "task capability object unknown action",
			source: strings.Join([]string{
				`task BadCapObject {`,
				`  static readonly capabilities = [{ action: "bad:op", resource: "/workspace/**" }]`,
				`  effect call(id: string): string!never { return id }`,
				`}`,
			}, "\n"),
		},
		{
			name: "workflow invalid capabilities",
			source: strings.Join([]string{
				`workflow BadWorkflowCaps {`,
				`  static readonly capabilities = ["nope:write:/x"]`,
				`  effect call(id: string): string!never { return id }`,
				`}`,
			}, "\n"),
		},
		{
			name: "task invalid effects array",
			source: strings.Join([]string{
				`task BadEffectsArray {`,
				`  static readonly effects = ["not:an:action"]`,
				`  effect call(id: string): string!never { return id }`,
				`}`,
			}, "\n"),
		},
		{
			name: "task invalid effects envelope",
			source: strings.Join([]string{
				`task BadEffectsEnvelope {`,
				`  static readonly effects = { writes: ["nope:action"] }`,
				`  effect call(id: string): string!never { return id }`,
				`}`,
			}, "\n"),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			diags := durableCapDiagnostics(t, tc.source, "")
			foundError := false
			for _, d := range diags {
				if d.Category() == diagnostics.CategoryError {
					foundError = true
				}
			}
			if !foundError {
				t.Fatalf("expected type error for %s, got diagnostics: %v", tc.name, diags)
			}
		})
	}
}

func TestTaskMissingTierWarning(t *testing.T) {
	t.Run("warns when body requires HttpClient without tier", func(t *testing.T) {
		source := strings.Join([]string{
			`task FetchPage {`,
			`  effect call(url: string): string!string {`,
			`    const client = try HttpClient.HttpClient`,
			`    const res = try mapError(client.get(url), (e) => e.message)`,
			`    return try mapError(res.text, (e) => e.message)`,
			`  }`,
			`}`,
		}, "\n")
		var warnings []*ast.Diagnostic
		for _, d := range durableCapDiagnostics(t, source, "") {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected error: %s", d.String())
			}
			if d.Source() == diagnosticSource && d.Code() == 5801 {
				warnings = append(warnings, d)
			}
		}
		if len(warnings) != 1 {
			t.Fatalf("expected 1 EK5801 warning, got %d", len(warnings))
		}
		if got := warnings[0].String(); !strings.Contains(got, "FetchPage") || !strings.Contains(got, "HttpClient") {
			t.Fatalf("unexpected EK5801 message: %s", got)
		}
	})

	t.Run("warns when body requires ChildProcessSpawner without tier", func(t *testing.T) {
		source := strings.Join([]string{
			`task RunGit {`,
			`  effect call(arg: string): string!string {`,
			`    const spawner = try ChildProcessSpawner.ChildProcessSpawner`,
			`    return try mapError(spawner.string(ChildProcess.make("echo", [arg])), (e) => e.message)`,
			`  }`,
			`}`,
		}, "\n")
		var warnings []*ast.Diagnostic
		for _, d := range durableCapDiagnostics(t, source, "") {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected error: %s", d.String())
			}
			if d.Source() == diagnosticSource && d.Code() == 5801 {
				warnings = append(warnings, d)
			}
		}
		if len(warnings) != 1 {
			t.Fatalf("expected 1 EK5801 warning, got %d", len(warnings))
		}
		if got := warnings[0].String(); !strings.Contains(got, "RunGit") || !strings.Contains(got, "ChildProcessSpawner") {
			t.Fatalf("unexpected EK5801 message: %s", got)
		}
	})

	t.Run("warns naming both HttpClient and ChildProcessSpawner", func(t *testing.T) {
		source := strings.Join([]string{
			`task FetchAndRun {`,
			`  effect call(url: string): string!string {`,
			`    const client = try HttpClient.HttpClient`,
			`    const spawner = try ChildProcessSpawner.ChildProcessSpawner`,
			`    const res = try mapError(client.get(url), (e) => e.message)`,
			`    const text = try mapError(res.text, (e) => e.message)`,
			`    return try mapError(spawner.string(ChildProcess.make("echo", [text])), (e) => e.message)`,
			`  }`,
			`}`,
		}, "\n")
		var warnings []*ast.Diagnostic
		for _, d := range durableCapDiagnostics(t, source, "") {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected error: %s", d.String())
			}
			if d.Source() == diagnosticSource && d.Code() == 5801 {
				warnings = append(warnings, d)
			}
		}
		if len(warnings) != 1 {
			t.Fatalf("expected 1 EK5801 warning, got %d", len(warnings))
		}
		if got := warnings[0].String(); !strings.Contains(got, "HttpClient and ChildProcessSpawner") {
			t.Fatalf("expected both services in EK5801 message: %s", got)
		}
	})

	t.Run("warns transitively through helper effect function", func(t *testing.T) {
		source := strings.Join([]string{
			`effect function getUrl(url: string) {`,
			`  const client = try HttpClient.HttpClient`,
			`  const res = try client.get(url)`,
			`  return try res.text`,
			`}`,
			`task IndirectFetch {`,
			`  effect call(url: string): string!string {`,
			`    return try mapError(getUrl(url), (e) => e.message)`,
			`  }`,
			`}`,
		}, "\n")
		var warnings []*ast.Diagnostic
		for _, d := range durableCapDiagnostics(t, source, "") {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected error: %s", d.String())
			}
			if d.Source() == diagnosticSource && d.Code() == 5801 {
				warnings = append(warnings, d)
			}
		}
		if len(warnings) != 1 {
			t.Fatalf("expected 1 EK5801 warning for transitive HttpClient requirement, got %d", len(warnings))
		}
	})

	t.Run("no warning when tier is explicitly declared or unrelated service is used", func(t *testing.T) {
		source := strings.Join([]string{
			`service HttpClient { static readonly key = "local/HttpClient"; get(url: string): string!! }`,
			`task ExplicitSealed {`,
			`  static readonly tier = "sealed"`,
			`  effect call(arg: string): string!string {`,
			`    const spawner = try ChildProcessSpawner.ChildProcessSpawner`,
			`    return try mapError(spawner.string(ChildProcess.make("echo", [arg])), (e) => e.message)`,
			`  }`,
			`}`,
			`task ExplicitIrreversible {`,
			`  static readonly tier = "irreversible"`,
			`  effect call(arg: string): string!string {`,
			`    const spawner = try ChildProcessSpawner.ChildProcessSpawner`,
			`    return try mapError(spawner.string(ChildProcess.make("echo", [arg])), (e) => e.message)`,
			`  }`,
			`}`,
			`task UsesFileSystemOnly {`,
			`  effect call(path: string): string!string {`,
			`    const fs = try FileSystem.FileSystem`,
			`    return try mapError(fs.readFileString(path), (e) => e.message)`,
			`  }`,
			`}`,
			`task UsesLocalHttpClient {`,
			`  effect call(url: string): string!never {`,
			`    const client = try HttpClient`,
			`    return try client.get(url)`,
			`  }`,
			`}`,
			`task DeclaredOnly {`,
			`  effect call(url: string): string!string`,
			`}`,
		}, "\n")
		for _, d := range durableCapDiagnostics(t, source, "") {
			if d.Source() == diagnosticSource && d.Code() == 5801 {
				t.Fatalf("unexpected EK5801 warning: %s", d.String())
			}
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected error: %s", d.String())
			}
		}
	})

	t.Run("severity override via vibe.severities", func(t *testing.T) {
		source := strings.Join([]string{
			`task FetchPage {`,
			`  effect call(url: string): string!string {`,
			`    const client = try HttpClient.HttpClient`,
			`    const res = try mapError(client.get(url), (e) => e.message)`,
			`    return try mapError(res.text, (e) => e.message)`,
			`  }`,
			`}`,
		}, "\n")
		for _, d := range durableCapDiagnostics(t, source, `{"experimental":["builtins"],"severities":{"EK5801":"off"}}`) {
			if d.Source() == diagnosticSource && d.Code() == 5801 {
				t.Fatalf("EK5801 should be suppressed when set to off: %s", d.String())
			}
		}
		promoted := false
		for _, d := range durableCapDiagnostics(t, source, `{"experimental":["builtins"],"severities":{"EK5801":"error"}}`) {
			if d.Source() == diagnosticSource && d.Code() == 5801 && d.Category() == diagnostics.CategoryError {
				promoted = true
			}
		}
		if !promoted {
			t.Fatal("EK5801 was not promoted to error by vibe.severities")
		}
	})
}

func TestWorkflowPlanDeclarationEmit(t *testing.T) {
	source := strings.Join([]string{
		`task Step {`,
		`  static readonly tier = "compensable"`,
		`  static readonly capabilities = ["fs:write:/workspace/**"]`,
		`  effect call(path: string): string!never { return path }`,
		`}`,
		`export workflow Flow {`,
		`  effect call(path: string): string!never { return try Step(path) }`,
		`}`,
		`export const plan = Flow.plan`,
		`export const annotated: Experimental.Capability.WorkflowPlan = Flow.plan`,
		``,
	}, "\n")
	program, dts := durableWorkflowProgram(t, nil, source)
	for _, d := range program.GetDeclarationDiagnostics(t.Context(), nil) {
		t.Errorf("declaration diagnostic: %s", d.String())
	}
	if !strings.Contains(dts, "WorkflowPlan") {
		t.Fatalf("expected emitted declaration to expose WorkflowPlan:\n%s", dts)
	}
}

func TestDurableCapabilityChecksAreGated(t *testing.T) {
	t.Parallel()
	source := `import { HttpClient } from "effect/http"
task Fetch {
  effect call(url: string): number!string { const client = try HttpClient.HttpClient; return url.length }
}
`
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK5801.Code {
			t.Fatalf("a gated file should not report EK5801: %s", d.String())
		}
	}
}

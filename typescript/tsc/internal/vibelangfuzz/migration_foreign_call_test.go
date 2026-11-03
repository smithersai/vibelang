package vibelangfuzz

import (
	"context"
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const migrationForeignCallTarget = "FuzzMigrationForeignCallPositions"

// Chapter 3 says how effect code calls a function that may throw.
const migrationForeignCallQuote = "Wrap it: `try Effect.try(() => parse(s))`"

const migrationForeignCallHelpers = `import * as Effect from "effect/Effect"
export const one = (): Effect.Effect<number> => Effect.succeed(1)
export const double = (n: number): number => n * 2
export const refuse = (n: number): number => {
  if (n < 0) throw new RangeError("negative")
  return n
}
export const pair = (a: number, b: number): readonly [number, number] => [a, b]
export const counter = { next: (n: number): number => n + 1 }
`

// The positions a call can stand in, in the body of an Effect.gen. CALL is the
// call. Smithers supplies the const, the template's substitution and the
// receiver; the rest finish the neighbourhood.
func migrationForeignCallPositions() map[string]string {
	return map[string]string{
		"const":          "const v = CALL\n  return v",
		"let":            "let v = 0\n  v = CALL\n  return v",
		"return":         "return CALL",
		"statement":      "CALL\n  return 0",
		"operand":        "return 1 + CALL",
		"negated":        "return -CALL",
		"second-const":   "const a = yield* one(), b = CALL\n  return a + b",
		"template":       "return `v=${CALL}`",
		"tagged":         "return yield* tag`v=${CALL}`",
		"argument":       "return yield* Effect.succeed(CALL)",
		"object":         "return { v: CALL }",
		"array":          "return [CALL]",
		"spread":         "return [...[CALL]]",
		"parenthesized":  "return (CALL)",
		"as":             "return (CALL) as number",
		"ternary-test":   "return CALL > 0 ? 1 : 2",
		"ternary-branch": "return n > 0 ? CALL : 0",
		"and":            "return n > 0 && CALL > 0",
		"coalesce":       "return (n as number | undefined) ?? CALL",
		"guard-ternary":  "return o.p ? CALL : 0",
		"guard-nested":   "return o.p ? CALL : n > 0 ? double(n) : double(0)",
		"guard-and":      "return o.p !== undefined && CALL > 0",
		"guard-if":       "if (o.p) {\n    const v = CALL\n    return v\n  }\n  return 0",
		"guard-early":    "if (!o.p) return 0\n  return CALL",
		"if-test":        "if (CALL > 0) return 1\n  return 2",
		"if-branch":      "if (n > 0) {\n    return CALL\n  }\n  return 2",
		"if-unbraced":    "if (n > 0) return CALL\n  return 2",
		"switch-test":    "switch (CALL) {\n    case 0: return 1\n    default: return 2\n  }",
		"while-test":     "let i = 0\n  while (CALL < 0 && i < 2) i++\n  return i",
		"for-test":       "let t = 0\n  for (let i = 0; i < CALL && i < 2; i++) t++\n  return t",
		"for-of":         "let t = 0\n  for (const k of [CALL]) t += k\n  return t",
		"for-body":       "let t = 0\n  for (const k of [1, 2]) {\n    t += k + CALL\n  }\n  return t",
		"callback":       "return [1].map((k) => k + CALL)",
		"nested":         "return double(CALL)",
		"receiver":       "return pair(CALL, 2)[0]",
	}
}

// The calls: each kind of callee, and operands that run or hold an Effect.
func migrationForeignCallCalls() map[string]string {
	return map[string]string{
		"name":      "double(n)",
		"namespace": "Helpers.double(n)",
		"method":    "counter.next(n)",
		"throws":    "refuse(n)",
		"narrowed":  "double(o.p)",
		"running":   "double(yield* one())",
		"two":       "pair(yield* one(), yield* one())[0]",
	}
}

const migrationForeignCallPrefix = `import * as Effect from "effect/Effect"
import * as Helpers from "./helpers.js"
import { counter, double, one, pair, refuse } from "./helpers.js"
const tag = (parts: TemplateStringsArray, ...values: ReadonlyArray<number>): Effect.Effect<string> =>
  Effect.succeed(parts.join("?") + values.join(","))
`

// migrationForeignCallSource returns the module in Effect TypeScript, and the
// same module in the effect code --fix meets once its generators are written.
func migrationForeignCallSource(position, call string) (typescript, vibe string) {
	body := strings.ReplaceAll(migrationForeignCallPositions()[position], "CALL", migrationForeignCallCalls()[call])
	typescript = migrationForeignCallPrefix + "export const value = (n: number, o: { readonly p?: number } = {}) =>\n  Effect.gen(function* () {\n  " + body + "\n  })\n"
	vibe = migrationForeignCallPrefix + "export const value = effect (n: number, o: { readonly p?: number } = {}) => {\n  " + strings.ReplaceAll(body, "yield*", "try") + "\n}\n"
	return typescript, vibe
}

func TestMigrationForeignCallQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), migrationForeignCallQuote) {
		t.Fatalf("Chapter 3 no longer says %q; update the oracle", migrationForeignCallQuote)
	}
}

func parseMigrationForeignCall(input string) (string, string) {
	positions, calls := slices.Sorted(maps.Keys(migrationForeignCallPositions())), slices.Sorted(maps.Keys(migrationForeignCallCalls()))
	if position, call, ok := strings.Cut(input, "/"); ok && slices.Contains(positions, position) && slices.Contains(calls, call) {
		return position, call
	}
	sum := 0
	for i := range len(input) {
		sum = sum*31 + int(input[i])
	}
	if sum < 0 {
		sum = -sum
	}
	return positions[sum%len(positions)], calls[sum%len(calls)]
}

// migrationForeignCallErrors returns the errors left, without EK4401's: a fix
// that would move what runs is refused, and the diagnostic says so.
func migrationForeignCallErrors(all []*ast.Diagnostic) (left []string, refused bool) {
	for _, d := range all {
		switch {
		case d.Category() != diagnostics.CategoryError:
		case d.Code() == vibelang.EK4401.Code:
			refused = true
		default:
			left = append(left, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
		}
	}
	return left, refused
}

// checkMigrationForeignCall compares a module's stock TypeScript declarations
// with its declarations after a migration: rename to .vibe, then --fix.
func checkMigrationForeignCall(t *testing.T, w *Workspace, api, input string) {
	t.Helper()
	TestMigrationForeignCallQuoted(t)
	position, call := parseMigrationForeignCall(input)
	key := "position:" + position + ":" + call
	source, vibe := migrationForeignCallSource(position, call)
	helpers := map[string]string{"helpers.ts": migrationForeignCallHelpers}
	with := func(name, text string) map[string]string {
		files := maps.Clone(helpers)
		files[name] = text
		return files
	}
	toolsGuard(t, migrationForeignCallTarget, func() {
		before := toolsCompile(t, w, migrationForeignCallTarget, with("main.ts", source))
		defer before.Remove()
		if !toolsErrorFree(before) {
			left, _ := migrationForeignCallErrors(before.Diagnostics)
			t.Skipf("not a well-typed TypeScript module: %v", left)
		}
		renamed := toolsCompile(t, w, migrationForeignCallTarget, with("main.vibe", vibe))
		defer renamed.Remove()
		config := toolsConfig(w, renamed.Dir)
		var result *vibelang.FixResult
		toolsRun(t, migrationForeignCallTarget, "fix", vibe, nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		})
		if result.Err != nil {
			Gap(t, migrationForeignCallTarget, key, "Chapter 3: --fix failed: %v\n%s", result.Err, vibe)
		}
		fixed := with("main.vibe", vibe)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(renamed.Dir)+"/")] = file.Text
		}
		after := toolsCompile(t, w, migrationForeignCallTarget, fixed)
		defer after.Remove()
		left, refused := migrationForeignCallErrors(after.Diagnostics)
		if len(left) > 0 {
			Gap(t, migrationForeignCallTarget, key, "Chapter 3: %q; after --fix: %v\nfixed:\n%s", migrationForeignCallQuote, left, fixed["main.vibe"])
			return
		}
		if refused && call == "narrowed" {
			Gap(t, migrationForeignCallTarget, key, "Chapter 3: %q; --fix refused a call whose property a guard narrowed\nfixed:\n%s", migrationForeignCallQuote, fixed["main.vibe"])
			return
		}
		if refused {
			return // no declarations to compare: the module stays .ts
		}
		baseline, current := t.TempDir(), t.TempDir()
		for _, side := range []struct {
			dir    string
			result *Result
		}{{baseline, before}, {current, after}} {
			for name, text := range side.result.Outputs {
				if strings.HasPrefix(name, "out/") && isDeclaration(name) {
					if err := writeInside(side.dir, strings.TrimPrefix(name, "out/"), text); err != nil {
						t.Fatal(err)
					}
				}
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
		defer cancel()
		diff, err := compareIdentityDeclarations(ctx, api, baseline, current)
		if err != nil {
			t.Fatal(err)
		}
		if diff != "" {
			Gap(t, migrationForeignCallTarget, key, "Chapter 7: %q\n%s\nsource:\n%s\nfixed:\n%s", migrationDeclarationFixQuote, diff, source, fixed["main.vibe"])
			return
		}
		ExpectPending(t, migrationForeignCallTarget, key)
	})
}

func FuzzMigrationForeignCallPositions(f *testing.F) {
	startShortBudget(f)
	positions, calls := slices.Sorted(maps.Keys(migrationForeignCallPositions())), slices.Sorted(maps.Keys(migrationForeignCallCalls()))
	for i, position := range positions {
		// Under -short each position meets one call; a campaign meets all.
		f.Add(position + "/" + calls[i%len(calls)])
		if strings.HasPrefix(position, "guard-") {
			f.Add(position + "/narrowed")
		}
		if !testing.Short() {
			for _, call := range calls {
				f.Add(position + "/" + call)
			}
		}
	}
	w := NewWorkspace(f)
	api := declarationIdentityAPI(f)
	f.Fuzz(func(t *testing.T, input string) {
		checkMigrationForeignCall(t, w, api, input)
	})
}

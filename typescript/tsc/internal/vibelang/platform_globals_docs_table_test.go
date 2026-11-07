package vibelang

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

// The guide expands short diagnostic advice where native behavior requires
// a qualification: elapsed-clock origins, user-only arguments, optional IDs,
// half-open bounds and the TypeScript boundary. It also uses distinct crypto
// key names and imports the worker namespace. Pin both sides so an API change
// still requires reviewing its documented counterpart.
var platformGlobalDocVariants = map[string]struct{ diagnostic, documented string }{
	"SharedWorker":            {"Worker and WorkerRunner", "`effect/workers`: `import { Worker as EffectWorker }` and `WorkerRunner`"},
	"Worker":                  {"Worker and WorkerRunner", "`effect/workers`: `import { Worker as EffectWorker }` and `WorkerRunner`. Bare `Worker` is Effect's `effect/workers` namespace, and `globalThis.Worker` is EK4402"},
	"crypto.createCipheriv":   {"`try (try Aead.Aead).encrypt(key, plaintext, { nonce })`", "`try (try Aead.Aead).encrypt(aeadKey, plaintext, { nonce })`"},
	"crypto.createDecipheriv": {"`try (try Aead.Aead).decrypt(key, ciphertext, { nonce })`", "`try (try Aead.Aead).decrypt(aeadKey, ciphertext, { nonce })`"},
	"crypto.createHmac":       {"`try (try Mac.Mac).sign(key, data)`", "`try (try Mac.Mac).sign(macKey, data)`"},
	"crypto.randomInt":        {"`try (try SecureRandom.SecureRandom).intBetween(min, max)`", "`try (try SecureRandom.SecureRandom).intBetween(min, max, { halfOpen: true })`"},
	"crypto.subtle":           {"`try (try Mac.Mac).sign(key, data)`", "`try (try Mac.Mac).sign(macKey, data)`"},
	"crypto.webcrypto":        {"`try (try Mac.Mac).sign(key, data)`", "`try (try Mac.Mac).sign(macKey, data)`"},
	"importScripts":           {"Worker and WorkerRunner", "`effect/workers`: `import { Worker as EffectWorker }` and `WorkerRunner`"},
	"performance.now":         {"`Number(try Clock.monotonicTimeNanos) / 1e6`", "For elapsed intervals, subtract readings from the same clock: `Number((try Clock.monotonicTimeNanos) - startNanos) / 1e6`. The clock has an arbitrary origin; keep reads requiring the native origin in a `.ts` adapter."},
	"process.argv":            {"`try (try Stdio.Stdio).args`", "`try (try Stdio.Stdio).args` for user arguments, matching `process.argv.slice(2)`; read the full array in a `.ts` adapter."},
	"process.getuid":          {"`try (try Experimental.Process.Process).currentUid`", "`try (try Experimental.Process.Process).currentUid`; absent is `undefined`, root is `0`, native errors stay typed failures"},
	"process.version":         {"`try (try Experimental.Process.Process).versions`", "`\"v\" + (try (try Experimental.Process.Process).versions).node` on Node; `versions` itself is a map of component versions."},
	"require.resolve":         {"escape to TypeScript for now: Effect has no module-resolution service; keep module resolution in TypeScript.", "escape to TypeScript: resolve in a `.ts` module and call it with `Effect.try`, because `import.meta` allows only `.url`"},
}

func platformGlobalNames() []string {
	var names []string
	for name := range platformGlobals {
		names = append(names, name)
	}
	for api := range platformAPIs {
		root, _, _ := strings.Cut(api, ".")
		if _, ok := platformGlobals[root]; ok && api != root && !strings.Contains(api, "*") {
			names = append(names, api)
		}
	}
	slices.Sort(names)
	return names
}

func platformGlobalDocumentedAnswer(name, answer string) (string, error) {
	if variant, ok := platformGlobalDocVariants[name]; ok {
		if answer != variant.diagnostic {
			return "", fmt.Errorf("%s: diagnostic changed from %s to %s; review its qualified guide example", name, variant.diagnostic, answer)
		}
		return variant.documented, nil
	}
	// The guide shows execution of these cold Effects. Other replacements,
	// such as Stream.fromEventListener, remain ordinary expression values.
	// The diagnostic itself already runs HttpClient.get, sleep and repeat.
	for _, prefix := range []string{"\x60Console."} {
		if strings.HasPrefix(answer, prefix) {
			return "\x60try " + answer[1:], nil
		}
	}
	if answer == "\x60try Effect.yieldNow\x60" {
		return "\x60try yieldNow\x60", nil
	}
	return answer, nil
}

func platformGlobalsTable(page string) ([]string, []string) {
	const header = "| Global | Use instead |\n"
	_, table, found := strings.Cut(page, header)
	if !found {
		return nil, []string{"missing platform globals table"}
	}
	lines := strings.Split(table, "\n")
	if len(lines) == 0 || lines[0] != "| --- | --- |" {
		return nil, []string{"invalid platform globals table separator"}
	}
	var rows []string
	for _, line := range lines[1:] {
		if !strings.HasPrefix(line, "|") {
			break
		}
		rows = append(rows, line)
	}
	return rows, nil
}

func platformGlobalsProblems(page string) []string {
	rows, problems := platformGlobalsTable(page)
	names := platformGlobalNames()
	seen := map[string]bool{}
	for _, line := range rows {
		cells := platformDocCells(line)
		if len(cells) != 2 {
			problems = append(problems, fmt.Sprintf("platform global row has %d columns: %s", len(cells), line))
			continue
		}
		name, prose, ok := platformDocCode(cells[0])
		if !ok || prose != "" {
			problems = append(problems, "invalid platform global name: "+cells[0])
			continue
		}
		if !slices.Contains(names, name) {
			problems = append(problems, "unknown platform global: "+name)
			continue
		}
		if seen[name] {
			problems = append(problems, "duplicate platform global: "+name)
		}
		seen[name] = true
		answer, err := platformGlobalDocumentedAnswer(name, platformGlobalAnswer(name))
		if err != nil {
			problems = append(problems, err.Error())
			continue
		}
		got, want := cells[1], answer
		if want == "" {
			problems = append(problems, name+": diagnostic gives no replacement")
			continue
		}
		if strings.Count(got, "\x60")%2 != 0 {
			problems = append(problems, name+": unclosed inline code")
			continue
		}
		// Escape reasons are prose; formatting an identifier as code does not
		// change the advice. Qualified variants retain their complete wording.
		if strings.HasPrefix(want, "escape to TypeScript for now:") {
			got, want = strings.ReplaceAll(got, "\x60", ""), strings.ReplaceAll(want, "\x60", "")
		}
		if got != want {
			problems = append(problems, fmt.Sprintf("%s: guide says %s; want %s", name, cells[1], answer))
		}
	}
	for _, name := range names {
		if !seen[name] {
			problems = append(problems, "missing platform global: "+name)
		}
	}
	return problems
}

func platformGlobalsPage(t testing.TB) string {
	t.Helper()
	page, err := os.ReadFile("../../../../docs/user/src/platform/platform-globals.md")
	if err != nil {
		t.Fatal(err)
	}
	return string(page)
}

func TestPlatformGlobalDocVariantsFollowDiagnostics(t *testing.T) {
	names := platformGlobalNames()
	for name, variant := range platformGlobalDocVariants {
		t.Run(name, func(t *testing.T) {
			if !slices.Contains(names, name) {
				t.Fatal("qualified example no longer names a platform global")
			}
			got, err := platformGlobalDocumentedAnswer(name, platformGlobalAnswer(name))
			if err != nil || got != variant.documented {
				t.Fatalf("qualified example lost its diagnostic: %q, %v", got, err)
			}
			if _, err := platformGlobalDocumentedAnswer(name, "changed diagnostic"); err == nil {
				t.Fatal("changed diagnostic did not require reviewing its qualified example")
			}
		})
	}
}

func TestPlatformGlobalsTableMutations(t *testing.T) {
	page := platformGlobalsPage(t)
	if problems := platformGlobalsProblems(page); len(problems) != 0 {
		t.Fatal(problems)
	}
	rows, _ := platformGlobalsTable(page)
	for _, row := range rows {
		cells := platformDocCells(row)
		name, _, _ := platformDocCode(cells[0])
		t.Run(name, func(t *testing.T) {
			for kind, damaged := range map[string]string{
				"removed":        "",
				"duplicate":      row + "\n" + row,
				"unknown":        "| \x60unknownGlobal\x60 | " + cells[1] + " |",
				"wrong API":      "| " + cells[0] + " | \x60Missing.api()\x60 |",
				"missing column": "| " + cells[0] + " |",
				"extra column":   row + " extra |",
				"unclosed code":  "| " + cells[0] + " | \x60Missing.api() |",
			} {
				t.Run(kind, func(t *testing.T) {
					if problems := platformGlobalsProblems(strings.Replace(page, row, damaged, 1)); len(problems) == 0 {
						t.Fatal("table damage was not rejected")
					}
				})
			}
			if answer := platformGlobalAnswer(name); answer != cells[1] {
				damaged := "| " + cells[0] + " | " + answer + " |"
				// Formatting prose identifiers is immaterial, but dropping a semantic
				// qualification or execution of an Effect must be rejected.
				if strings.ReplaceAll(answer, "\x60", "") != strings.ReplaceAll(cells[1], "\x60", "") &&
					len(platformGlobalsProblems(strings.Replace(page, row, damaged, 1))) == 0 {
					t.Fatal("unqualified diagnostic shorthand was accepted")
				}
			}
		})
	}
	reversed := slices.Clone(rows)
	slices.Reverse(reversed)
	if problems := platformGlobalsProblems(strings.Replace(page, strings.Join(rows, "\n"), strings.Join(reversed, "\n"), 1)); len(problems) != 0 {
		t.Fatalf("row order changed coverage: %v", problems)
	}
	for _, header := range []string{"| Global | Use instead |", "| --- | --- |"} {
		if len(platformGlobalsProblems(strings.Replace(page, header, "", 1))) == 0 {
			t.Fatal("missing table header was accepted")
		}
	}
}

// This property checks the documentation validator itself: arbitrary cell
// damage cannot reduce coverage, while whitespace and row order are immaterial.
func FuzzPlatformGlobalsTable(f *testing.F) {
	page := platformGlobalsPage(f)
	if problems := platformGlobalsProblems(page); len(problems) != 0 {
		f.Fatal(problems)
	}
	rows, _ := platformGlobalsTable(page)
	for i := range rows {
		f.Add(uint8(i), "replacement", "Missing.api()")
		f.Add(uint8(i), "name", "unknownGlobal")
	}
	f.Fuzz(func(t *testing.T, index uint8, field, damage string) {
		if len(damage) > 4096 || strings.ContainsAny(damage, "\x60\n\r") {
			return
		}
		row := rows[int(index)%len(rows)]
		cells := platformDocCells(row)
		padding := strings.Repeat(" ", int(index)%5+1)
		padded := "|" + padding + cells[0] + padding + "|" + padding + cells[1] + padding + "|"
		if problems := platformGlobalsProblems(strings.Replace(page, row, padded, 1)); len(problems) != 0 {
			t.Fatalf("rejected cell padding: %v", problems)
		}
		if field == "name" {
			cells[0] = "\x60invalid." + damage + "\x60"
		} else {
			cells[1] = "\x60invalid." + damage + "\x60"
		}
		damaged := "| " + cells[0] + " | " + cells[1] + " |"
		if len(platformGlobalsProblems(strings.Replace(page, row, damaged, 1))) == 0 {
			t.Fatalf("accepted damaged %s: %q", field, damage)
		}
	})
}

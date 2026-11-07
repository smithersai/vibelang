package vibelang

import (
	"cmp"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

type platformDocRow struct {
	call, effect, layer string
}

// Split only outside inline code. A union or pipe inside a displayed example
// is part of that cell, rather than a new Markdown column.
func platformDocCells(line string) []string {
	var cells []string
	code, start := false, 0
	for i, ch := range line {
		if ch == '\x60' {
			code = !code
		}
		if ch == '|' && !code {
			cells = append(cells, strings.TrimSpace(line[start:i]))
			start = i + 1
		}
	}
	cells = append(cells, strings.TrimSpace(line[start:]))
	if len(cells) > 0 && cells[0] == "" {
		cells = cells[1:]
	}
	if len(cells) > 0 && cells[len(cells)-1] == "" {
		cells = cells[:len(cells)-1]
	}
	return cells
}

func platformDocCode(cell string) (code, prose string, ok bool) {
	const tick = "\x60"
	if !strings.HasPrefix(cell, tick) {
		return "", "", false
	}
	code, prose, ok = strings.Cut(cell[1:], tick)
	return code, strings.TrimSpace(prose), ok && code != ""
}

func platformIntroductionRows(page string) ([]platformDocRow, []string) {
	const header = "| Call | Effect | Layer |"
	_, table, found := strings.Cut(page, header+"\n")
	if !found {
		return nil, []string{"missing platform replacement table"}
	}
	var rows []platformDocRow
	var problems []string
	for i, line := range strings.Split(table, "\n") {
		if i == 0 { // Markdown's column separator.
			if line != "| --- | --- | --- |" {
				problems = append(problems, "invalid platform table separator")
			}
			continue
		}
		if !strings.HasPrefix(line, "|") {
			break
		}
		cells := platformDocCells(line)
		if len(cells) != 3 {
			problems = append(problems, fmt.Sprintf("platform table row %d has %d columns", i, len(cells)))
			continue
		}
		rows = append(rows, platformDocRow{cells[0], cells[1], cells[2]})
	}
	return rows, problems
}

// These examples intentionally do more than a diagnostic's short suggestion:
// preserve bytes, inherited stdio or an elapsed interval, and show adapters for
// constructors and streams that have no direct diagnostic-table lookup.
func platformIntroductionVariant(call string) (example, layer string, ok bool) {
	switch call {
	case "http.createServer":
		return "try Layer.launch(HttpRouter.serve(app))", "ExperimentalNodeHttpServer.layer({ port })", true
	case "fs.readFile":
		return "try (try FileSystem.FileSystem).readFile(path)", "NodeServices.layer", true
	case "child_process.spawn":
		return "try (try Experimental.ChildProcess.ChildProcess).runInherited(command, args, options)", "ExperimentalNodeChildProcess.layer", true
	case "new Headers(headers)":
		return "try (try Experimental.Headers.Headers).copy(headers)", "Node, Bun or browser experimental layer", true
	case "Readable.fromWeb(response.body)":
		return "try (try Experimental.NodeStream.NodeStream).fromWeb(body, { response, signal })", "Node or Bun experimental layer", true
	case "new Request(url, request)":
		return "try (try Experimental.Request.Request).atUrl(url, request)", "Node, Bun or browser experimental layer", true
	case "performance.now() - start":
		return "Number((try Clock.monotonicTimeNanos) - startNanos) / 1e6", "none", true
	case "Date.now":
		return "try Clock.currentTimeMillis", "none", true
	case "Math.random":
		return "try Random.next", "none", true
	}
	return "", "", false
}

// This inventory prevents a malformed, removed or duplicated row from silently
// reducing coverage. Additional rows still go through the same comparisons.
var platformIntroductionRequired = []string{
	"fs.readFile", "os.tmpdir", "net.isIPv6", "child_process.spawn",
	"new Headers(headers)", "Readable.fromWeb(response.body)", "new Request(url, request)",
	"path.join", "process.cwd", "child_process.execFileSync", "fetch", "http.createServer",
	"crypto.randomUUID", "crypto.subtle.digest", "process.argv.slice(2)", "process.getuid?.()",
	"os.hostname", "os.homedir", "process.kill", "fs.constants.X_OK", "crypto.createHmac",
	"navigator.locks", "process.env", "console.log", "setTimeout", "Date.now",
	"performance.now() - start", "Math.random",
}

func platformIntroductionProblems(page string) []string {
	rows, problems := platformIntroductionRows(page)
	seen := map[string]bool{}
	for _, row := range rows {
		call, qualifier, ok := platformDocCode(row.call)
		if !ok {
			problems = append(problems, "invalid platform call cell: "+row.call)
			continue
		}
		if seen[call] {
			problems = append(problems, "duplicate platform call: "+call)
		}
		seen[call] = true
		if (call == "child_process.spawn" && qualifier != "with inherited stdio") ||
			(call != "child_process.spawn" && qualifier != "") {
			problems = append(problems, call+": unexpected call qualifier "+qualifier)
		}
		effect, _, ok := platformDocCode(row.effect)
		if !ok {
			problems = append(problems, call+": replacement must start with inline code")
			continue
		}
		layer := row.layer
		if strings.HasPrefix(layer, "\x60") {
			var prose string
			var valid bool
			layer, prose, valid = platformDocCode(layer)
			if !valid || prose != "" {
				problems = append(problems, call+": invalid layer cell "+row.layer)
			}
		}
		if example, provider, variant := platformIntroductionVariant(call); variant {
			if effect != example || layer != provider {
				problems = append(problems, fmt.Sprintf("%s: want %s provided by %s; got %s provided by %s", call, example, provider, effect, layer))
			}
			continue
		}
		lookup := call
		switch call {
		case "process.argv.slice(2)":
			lookup = "process.argv"
		case "process.getuid?.()":
			lookup = "process.getuid"
		}
		root, member, _ := strings.Cut(lookup, ".")
		ref := platformRef{name: root}
		if service, ok := platformGlobals[root]; ok {
			ref.replacement = service
		} else if service, ok := platformModuleOf(root); ok {
			ref.replacement, ref.module = service, root
		} else {
			problems = append(problems, call+": no platform API")
			continue
		}
		var members []string
		if member != "" {
			members = strings.Split(member, ".")
		}
		api := platformAPIOf(ref, members)
		service := platformServices[api.service]
		if service == nil {
			problems = append(problems, call+": diagnostic names no service")
			continue
		}
		example := cmp.Or(api.example, service.example)
		// These short diagnostic suggestions return Effects. The introduction
		// shows how to run them, rather than leaving cold Effects unused.
		switch example {
		case "Console.log(message)":
			example = "try " + example
		}
		if effect != example {
			problems = append(problems, fmt.Sprintf("%s: the page says %s, diagnostic says %s", call, effect, example))
		}
		if service.provider == "" {
			if layer != "none" && !(api.service == "ExperimentalNetAddress" && layer == "none (pure)") {
				problems = append(problems, call+": a pure or runtime-provided API needs no layer")
			}
		} else if layer == "" || !strings.Contains(" "+service.provider, " "+layer+" from ") {
			problems = append(problems, fmt.Sprintf("%s: the page provides %s, diagnostic says %s", call, layer, service.provider))
		}
	}
	for _, call := range platformIntroductionRequired {
		if !seen[call] {
			problems = append(problems, "missing platform call: "+call)
		}
	}
	return problems
}

func platformIntroductionPage(t testing.TB) string {
	t.Helper()
	page, err := os.ReadFile("../../../../docs/user/src/platform/105-introduction.md")
	if err != nil {
		t.Fatal(err)
	}
	return string(page)
}

func TestPlatformIntroductionTableMutations(t *testing.T) {
	page := platformIntroductionPage(t)
	rows, problems := platformIntroductionRows(page)
	if len(problems) != 0 {
		t.Fatal(problems)
	}
	if problems := platformIntroductionProblems(page); len(problems) != 0 {
		t.Fatal(problems)
	}
	for _, row := range rows {
		t.Run(row.call, func(t *testing.T) {
			line := "| " + row.call + " | " + row.effect + " | " + row.layer + " |"
			for name, replacement := range map[string]string{
				"wrong API":      "| " + row.call + " | \x60Missing.api()\x60 | " + row.layer + " |",
				"wrong layer":    "| " + row.call + " | " + row.effect + " | \x60Missing.layer\x60 |",
				"removed":        "",
				"duplicate":      line + "\n" + line,
				"missing column": "| " + row.call + " | " + row.effect + " |",
			} {
				t.Run(name, func(t *testing.T) {
					changed := strings.Replace(page, line, replacement, 1)
					if changed == page || len(platformIntroductionProblems(changed)) == 0 {
						t.Fatal("table damage was not rejected")
					}
				})
			}
			for _, layer := range []string{"layer", "NodeServices", ""} {
				bad := "| " + row.call + " | " + row.effect + " | " + layer + " |"
				if len(platformIntroductionProblems(strings.Replace(page, line, bad, 1))) == 0 {
					t.Fatalf("accepted incomplete provider %q", layer)
				}
			}
			effect, prose, _ := platformDocCode(row.effect)
			changedEffect := "try " + effect
			if strings.HasPrefix(effect, "try ") {
				changedEffect = strings.TrimPrefix(effect, "try ")
			}
			changed := strings.Replace(page, row.effect, "\x60"+changedEffect+"\x60 "+prose, 1)
			if len(platformIntroductionProblems(changed)) == 0 {
				t.Fatal("changed Effect execution was not rejected")
			}
		})
	}
}

func TestPlatformDocCells(t *testing.T) {
	got := platformDocCells("| \x60f(a | b)\x60 | \x60x |> f(%)\x60, with prose | none |")
	want := []string{"\x60f(a | b)\x60", "\x60x |> f(%)\x60, with prose", "none"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func FuzzPlatformIntroductionTable(f *testing.F) {
	page := platformIntroductionPage(f)
	if problems := platformIntroductionProblems(page); len(problems) != 0 {
		f.Fatal(problems)
	}
	rows, problems := platformIntroductionRows(page)
	if len(problems) != 0 {
		f.Fatal(problems)
	}
	for i := range rows {
		f.Add(uint8(i), "replacement", "Missing.api()")
		f.Add(uint8(i), "layer", "Missing.layer")
	}
	f.Fuzz(func(t *testing.T, index uint8, field, damage string) {
		if strings.ContainsAny(damage, "\x60\n\r") {
			return
		}
		row := rows[int(index)%len(rows)]
		padding := strings.Repeat(" ", int(index)%5)
		line := "| " + row.call + " | " + row.effect + " | " + row.layer + " |"
		padded := "|" + padding + row.call + padding + "|" + padding + row.effect + padding + "|" + padding + row.layer + padding + "|"
		if problems := platformIntroductionProblems(strings.Replace(page, line, padded, 1)); len(problems) != 0 {
			t.Fatalf("rejected cell padding: %v", problems)
		}
		if len(damage) > 4096 {
			return
		}
		old := row.effect
		if field == "layer" {
			old = row.layer
		}
		// Prefix arbitrary generated names so they cannot accidentally equal
		// a supported example or provider.
		replacement := "\x60invalid." + damage + "\x60"
		changedLine := strings.Replace(line, " | "+old+" |", " | "+replacement+" |", 1)
		changed := strings.Replace(page, line, changedLine, 1)
		if len(platformIntroductionProblems(changed)) == 0 {
			t.Fatalf("accepted damaged %s for %s: %q", field, row.call, damage)
		}
	})
}

package vibelangfuzz

import (
	"maps"
	"path"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// cliSpecCommandFlags attributes flags to explicit compiler invocations, not
// to arbitrary flag-shaped source expressions or strings in program examples.
func cliSpecCommandFlags(text string) []string {
	flag := regexp.MustCompile("^-{1,2}[A-Za-z][A-Za-z0-9_-]*$")
	assignment := regexp.MustCompile("^[A-Za-z_][A-Za-z0-9_]*=")
	found := map[string]bool{}
	command := func(text string) {
		words := strings.Fields(text)
		if len(words) > 0 && (words[0] == "$" || words[0] == ">") {
			words = words[1:]
		}
		for len(words) > 0 && assignment.MatchString(words[0]) {
			words = words[1:]
		}
		if len(words) > 0 && (words[0] == "npx" || words[0] == "bunx") {
			words = words[1:]
		}
		if len(words) > 1 && (words[0] == "npm" || words[0] == "pnpm") && words[1] == "exec" {
			words = words[2:]
			if len(words) > 0 && words[0] == "--" {
				words = words[1:]
			}
		}
		if len(words) == 0 {
			return
		}
		executable := path.Base(strings.ReplaceAll(strings.Trim(words[0], "'\""), "\\", "/"))
		if executable != "vibelang" && executable != "vibelang.exe" {
			return
		}
		for _, word := range words[1:] {
			if word == "&&" || word == "||" || word == "|" || word == ";" {
				break
			}
			word = strings.Trim(strings.TrimSuffix(word, ";"), "'\"")
			word, _, _ = strings.Cut(word, "=")
			if flag.MatchString(word) {
				found[word] = true
			}
		}
	}
	var prose strings.Builder
	flush := func() {
		text := prose.String()
		prose.Reset()
		for i := 0; i < len(text); {
			if text[i] != '`' {
				i++
				continue
			}
			start := i
			for i < len(text) && text[i] == '`' {
				i++
			}
			width := i - start
			body := i
			for i < len(text) {
				if text[i] != '`' {
					i++
					continue
				}
				end := i
				for i < len(text) && text[i] == '`' {
					i++
				}
				if i-end == width {
					command(strings.ReplaceAll(text[body:end], "\n", " "))
					break
				}
			}
		}
	}
	fence := byte(0)
	fenceWidth := 0
	shell := false
	var continued strings.Builder
	for line := range strings.SplitSeq(text, "\n") {
		trim := strings.TrimSpace(line)
		ch := byte(0)
		width := 0
		if len(trim) > 0 && (trim[0] == '`' || trim[0] == '~') {
			ch = trim[0]
			for width < len(trim) && trim[width] == ch {
				width++
			}
		}
		if fence != 0 {
			if ch == fence && width >= fenceWidth && strings.TrimSpace(trim[width:]) == "" {
				if continued.Len() > 0 {
					command(continued.String())
					continued.Reset()
				}
				fence = 0
				continue
			}
			if shell {
				if strings.HasSuffix(trim, "\\") {
					continued.WriteString(strings.TrimSuffix(trim, "\\"))
					continued.WriteByte(' ')
				} else {
					continued.WriteString(trim)
					command(continued.String())
					continued.Reset()
				}
			}
			continue
		}
		if width >= 3 && (ch != '`' || !strings.Contains(trim[width:], "`")) {
			flush()
			fence = ch
			fenceWidth = width
			info := strings.Fields(trim[width:])
			language := ""
			if len(info) > 0 {
				language = strings.ToLower(info[0])
			}
			switch language {
			case "", "sh", "bash", "zsh", "fish", "shell", "console", "shell-session", "terminal", "text", "powershell", "ps1":
				shell = true
			default:
				shell = false
			}
			continue
		}
		if trim == "" {
			flush()
			continue
		}
		prose.WriteString(line)
		prose.WriteByte('\n')
		if !strings.Contains(line, "`") {
			command(trim)
		}
	}
	flush()
	return slices.Sorted(maps.Keys(found))
}

func TestCLISpecCommandFlags(t *testing.T) {
	cases := []struct {
		name, text string
		want       []string
	}{
		{"inline", "Use `vibelang --future -p app`.", []string{"--future", "-p"}},
		{"native unary", "Values `-Infinity`, `-NaN`, `-value` and `--counter`.", nil},
		{"mixed domains", "`vibelang --future` preserves `-Infinity` and `--counter`.", []string{"--future"}},
		{"native template", "```ts effect\nconst text = `vibelang --not-an-option`\n```", nil},
		{"native vibe", "~~~vibe\nconst text = `vibelang --not-an-option`\n~~~", nil},
		{"shell", "```sh\nvibelang --future --noEmit\n```", []string{"--future", "--noEmit"}},
		{"shell echo", "```sh\necho vibelang --not-an-option\n```", nil},
		{"launcher", "`npx vibelang --future`", []string{"--future"}},
		{"exec", "`npm exec -- vibelang --future`", []string{"--future"}},
		{"environment", "`MODE=test vibelang --future`", []string{"--future"}},
		{"prompt", "```console\n$ vibelang --future\n```", []string{"--future"}},
		{"inline multi delimiter", "``vibelang --future `file` ``", []string{"--future"}},
		{"inline newline", "`vibelang\n --future`", []string{"--future"}},
		{"shell continuation", "```sh\nvibelang \\\n --future\n```", []string{"--future"}},
		{"long native fence", "````ts\n```\nconst text=`vibelang --not-an-option`\n````", nil},
		{"path", "`./built/vibelang --future`", []string{"--future"}},
		{"quoted option", "`vibelang '--future'`", []string{"--future"}},
		{"assigned option", "`vibelang --future=value`", []string{"--future"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := cliSpecCommandFlags(c.text); !slices.Equal(got, c.want) {
				t.Fatalf("flags=%v, want=%v", got, c.want)
			}
		})
	}
}

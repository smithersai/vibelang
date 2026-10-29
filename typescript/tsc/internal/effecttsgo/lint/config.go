package lint

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
)

// Config is the part of an Oxlint configuration that selects Effect's rules:
// its effecttsgo/* rules with their severities, its overrides and its ignorePatterns.
type Config struct {
	Dir       string                      // directory of the configuration file; globs are relative to it
	Rules     map[string]etscore.Severity // Effect rule name (camelCase) to severity
	Overrides []Override
	Ignore    []*regexp.Regexp
}

// Override applies Rules to the files that match one of Files.
type Override struct {
	Files []*regexp.Regexp
	Rules map[string]etscore.Severity
}

// oxlintConfig is the JSON shape of .oxlintrc.json and of oxlint.config.ts's default export.
type oxlintConfig struct {
	Extends   []string                   `json:"extends"`
	Rules     map[string]json.RawMessage `json:"rules"`
	Overrides []struct {
		Files []string                   `json:"files"`
		Rules map[string]json.RawMessage `json:"rules"`
	} `json:"overrides"`
	IgnorePatterns []string `json:"ignorePatterns"`
}

const rulePrefix = "effecttsgo/"

// ruleByOxlintName maps effecttsgo/kebab-case-name to the rule's own name, the
// way Effect's generated Oxlint plugin names them (_tools/repoctl/src/codegen.ts).
var ruleByOxlintName = func() map[string]string {
	m := make(map[string]string, len(rules.All))
	for _, r := range rules.All {
		m[rulePrefix+kebabCase(r.Name)] = r.Name
	}
	return m
}()

func kebabCase(name string) string {
	var b strings.Builder
	for i, ch := range name {
		if ch >= 'A' && ch <= 'Z' {
			prevLower := i > 0 && name[i-1] >= 'a' && name[i-1] <= 'z'
			nextLower := i+1 < len(name) && name[i+1] >= 'a' && name[i+1] <= 'z'
			if i > 0 && (prevLower || nextLower) {
				b.WriteByte('-')
			}
			b.WriteRune(ch + 'a' - 'A')
		} else {
			b.WriteRune(ch)
		}
	}
	return b.String()
}

// LoadConfig reads an Oxlint configuration file: JSON with comments, or a
// JavaScript or TypeScript module whose default export is the configuration,
// which node evaluates.
func LoadConfig(path string) (*Config, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	config := &Config{Dir: filepath.Dir(path), Rules: map[string]etscore.Severity{}}
	if err := config.load(path, map[string]bool{}); err != nil {
		return nil, err
	}
	return config, nil
}

func (c *Config) load(path string, seen map[string]bool) error {
	if seen[path] {
		return fmt.Errorf("%s: extends itself", path)
	}
	seen[path] = true
	raw, err := readConfig(path)
	if err != nil {
		return err
	}
	var oc oxlintConfig
	if err := json.Unmarshal(raw, &oc); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	for _, base := range oc.Extends {
		if !filepath.IsAbs(base) {
			base = filepath.Join(filepath.Dir(path), base)
		}
		if err := c.load(base, seen); err != nil {
			return err
		}
	}
	if err := addRules(c.Rules, oc.Rules, path); err != nil {
		return err
	}
	for _, o := range oc.Overrides {
		override := Override{Rules: map[string]etscore.Severity{}}
		for _, glob := range o.Files {
			override.Files = append(override.Files, globRegexp(glob))
		}
		if err := addRules(override.Rules, o.Rules, path); err != nil {
			return err
		}
		c.Overrides = append(c.Overrides, override)
	}
	for _, glob := range oc.IgnorePatterns {
		c.Ignore = append(c.Ignore, globRegexp(glob))
	}
	return nil
}

func readConfig(path string) ([]byte, error) {
	switch filepath.Ext(path) {
	case ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs":
		script := `const { pathToFileURL } = await import("node:url");
const m = await import(pathToFileURL(process.argv[1]).href);
process.stdout.write(JSON.stringify(m.default ?? m));`
		out, err := exec.Command("node", "--input-type=module", "-e", script, path).Output()
		if err != nil {
			if exit, ok := err.(*exec.ExitError); ok {
				return nil, fmt.Errorf("%s: node could not load it: %s", path, strings.TrimSpace(string(exit.Stderr)))
			}
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		return out, nil
	}
	text, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return stripJSONC(text), nil
}

func addRules(into map[string]etscore.Severity, from map[string]json.RawMessage, path string) error {
	for name, value := range from {
		if !strings.HasPrefix(name, rulePrefix) {
			continue
		}
		effectName, ok := ruleByOxlintName[name]
		if !ok {
			continue // a rule this compiler's copy of effect-tsgo does not have yet
		}
		severity, err := parseSeverity(value)
		if err != nil {
			return fmt.Errorf("%s: %s: %w", path, name, err)
		}
		into[effectName] = severity
	}
	return nil
}

// parseSeverity reads an Oxlint rule setting: "off", "warn", "error" (or
// "allow", "deny"), 0, 1, 2, or an array whose first element is one of those.
func parseSeverity(raw json.RawMessage) (etscore.Severity, error) {
	var list []json.RawMessage
	if json.Unmarshal(raw, &list) == nil && len(list) > 0 {
		raw = list[0]
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return etscore.SeverityOff, err
	}
	switch v := value.(type) {
	case string:
		switch strings.ToLower(v) {
		case "off", "allow":
			return etscore.SeverityOff, nil
		case "warn":
			return etscore.SeverityWarning, nil
		case "error", "deny":
			return etscore.SeverityError, nil
		}
	case float64:
		switch v {
		case 0:
			return etscore.SeverityOff, nil
		case 1:
			return etscore.SeverityWarning, nil
		case 2:
			return etscore.SeverityError, nil
		}
	}
	return etscore.SeverityOff, fmt.Errorf("unknown severity %s", raw)
}

// SeverityFor returns the rules that apply to file, an absolute path, after the overrides that match it.
func (c *Config) SeverityFor(file string) map[string]etscore.Severity {
	rel := c.relative(file)
	severity := make(map[string]etscore.Severity, len(c.Rules))
	for name, s := range c.Rules {
		severity[name] = s
	}
	for _, o := range c.Overrides {
		if matchAny(o.Files, rel) {
			for name, s := range o.Rules {
				severity[name] = s
			}
		}
	}
	return severity
}

// Ignored reports whether file matches one of the configuration's ignorePatterns.
func (c *Config) Ignored(file string) bool {
	return matchAny(c.Ignore, c.relative(file))
}

func (c *Config) relative(file string) string {
	rel, err := filepath.Rel(c.Dir, file)
	if err != nil {
		return filepath.ToSlash(file)
	}
	return filepath.ToSlash(rel)
}

func matchAny(globs []*regexp.Regexp, rel string) bool {
	for _, g := range globs {
		if g.MatchString(rel) {
			return true
		}
	}
	return false
}

// globRegexp compiles a gitignore-style glob as Oxlint reads one: a pattern
// without a slash matches at any depth, a trailing slash matches a directory's
// contents, * stays within a path segment and ** crosses segments.
func globRegexp(glob string) *regexp.Regexp {
	glob = strings.TrimPrefix(glob, "./")
	anchored := strings.Contains(strings.TrimSuffix(glob, "/"), "/")
	glob = strings.TrimPrefix(glob, "/")
	var b strings.Builder
	if !anchored {
		b.WriteString("(?:^|.*/)")
	} else {
		b.WriteString("^")
	}
	for i := 0; i < len(glob); i++ {
		ch := glob[i]
		switch {
		case ch == '*' && i+1 < len(glob) && glob[i+1] == '*':
			i++
			if i+1 < len(glob) && glob[i+1] == '/' {
				i++
				b.WriteString("(?:.*/)?")
			} else {
				b.WriteString(".*")
			}
		case ch == '*':
			b.WriteString("[^/]*")
		case ch == '?':
			b.WriteString("[^/]")
		default:
			b.WriteString(regexp.QuoteMeta(string(ch)))
		}
	}
	if strings.HasSuffix(glob, "/") {
		b.WriteString(".*")
	} else {
		b.WriteString("(?:/.*)?")
	}
	b.WriteString("$")
	return regexp.MustCompile(b.String())
}

// stripJSONC removes comments and trailing commas outside strings.
func stripJSONC(text []byte) []byte {
	var out []byte
	inString := false
	for i := 0; i < len(text); i++ {
		ch := text[i]
		if inString {
			out = append(out, ch)
			if ch == '\\' && i+1 < len(text) {
				i++
				out = append(out, text[i])
			} else if ch == '"' {
				inString = false
			}
			continue
		}
		switch {
		case ch == '"':
			inString = true
			out = append(out, ch)
		case ch == '/' && i+1 < len(text) && text[i+1] == '/':
			for i < len(text) && text[i] != '\n' {
				i++
			}
			i--
		case ch == '/' && i+1 < len(text) && text[i+1] == '*':
			i += 2
			for i+1 < len(text) && (text[i] != '*' || text[i+1] != '/') {
				i++
			}
			i++
		case ch == ']' || ch == '}':
			j := len(out) - 1
			for j >= 0 && (out[j] == ' ' || out[j] == '\t' || out[j] == '\n' || out[j] == '\r') {
				j--
			}
			if j >= 0 && out[j] == ',' {
				out = append(out[:j], out[j+1:]...)
			}
			out = append(out, ch)
		default:
			out = append(out, ch)
		}
	}
	return out
}

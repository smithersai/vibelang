package lint

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// The files `vibelang lint` walks are the files Oxlint walks for the same
// invocation. Oxlint 1.85.0 (apps/oxlint/src/walk.rs and oxc_config's
// configure_walk_builder) reads nested `.gitignore` files up to the repository
// boundary (a directory with `.git` or `.jj`; without one, every parent),
// `.git/info/exclude`, and, unless `--no-ignore` is given, the `--ignore-path`
// file (`.eslintignore` by default, looked up like `.gitignore`) and each
// `--ignore-pattern`. It does not read `.ignore` files or the global gitignore.
// The configuration's ignorePatterns apply as well (Config.Ignored).

// ignoreOptions are the command's ignore flags.
type ignoreOptions struct {
	ignorePath string   // --ignore-path: the name of an ignore file read beside each .gitignore
	patterns   []string // --ignore-pattern: globs relative to the current directory
	noIgnore   bool     // --no-ignore: neither the ignore-path file nor the patterns apply
}

const defaultIgnorePath = ".eslintignore"

type ignoreRule struct {
	re      *regexp.Regexp
	negate  bool // a `!` pattern re-includes what an earlier pattern excluded
	dirOnly bool // a trailing `/` matches a directory and what it contains
}

// ignoreList is one ignore file: its rules, relative to dir, in file order.
type ignoreList struct {
	dir   string
	rules []ignoreRule
}

// parseIgnore reads gitignore syntax: blank lines and `#` comments are
// skipped, `!` negates, a leading `\` keeps a literal `#` or `!`, and
// trailing spaces are not part of a pattern.
func parseIgnore(dir, text string) *ignoreList {
	list := &ignoreList{dir: dir}
	for line := range strings.SplitSeq(text, "\n") {
		line = strings.TrimRight(strings.TrimSuffix(line, "\r"), " \t")
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		rule := ignoreRule{}
		if strings.HasPrefix(line, "!") {
			rule.negate = true
			line = line[1:]
		}
		if strings.HasPrefix(line, "\\#") || strings.HasPrefix(line, "\\!") {
			line = line[1:]
		}
		if line == "" || line == "/" {
			continue
		}
		if strings.HasSuffix(line, "/") {
			rule.dirOnly = true
			line = strings.TrimSuffix(line, "/")
		}
		rule.re = globRegexp(line)
		list.rules = append(list.rules, rule)
	}
	return list
}

// match reports whether a rule of the list decides path's fate and, if so,
// whether path is ignored. The last matching rule wins. A directory-only
// rule matches a file through an ancestor directory of it.
func (l *ignoreList) match(path string, isDir bool) (decided, ignored bool) {
	rel, err := filepath.Rel(l.dir, path)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return false, false
	}
	rel = filepath.ToSlash(rel)
	for _, rule := range l.rules {
		if !rule.re.MatchString(rel) {
			continue
		}
		if rule.dirOnly && !isDir && !rule.re.MatchString(pathDir(rel)) {
			continue
		}
		decided, ignored = true, !rule.negate
	}
	return decided, ignored
}

func pathDir(rel string) string {
	if i := strings.LastIndexByte(rel, '/'); i >= 0 {
		return rel[:i]
	}
	return "."
}

// ignorer answers whether the walk skips a path, from the ignore sources above.
type ignorer struct {
	cwd      string
	names    []string // ignore file names in rising precedence within a directory
	patterns []*regexp.Regexp
	lists    map[string][]*ignoreList // ignore files of a directory, lowest precedence first
}

func newIgnorer(cwd string, options ignoreOptions) *ignorer {
	g := &ignorer{cwd: cwd, names: []string{".gitignore"}, lists: map[string][]*ignoreList{}}
	if options.noIgnore {
		return g
	}
	name := options.ignorePath
	if name == "" {
		name = defaultIgnorePath
	}
	g.names = append(g.names, name)
	for _, pattern := range options.patterns {
		g.patterns = append(g.patterns, globRegexp(strings.TrimSuffix(pattern, "/")))
	}
	return g
}

// ignored reports whether path, an absolute path, is excluded: by an
// --ignore-pattern (relative to the current directory), else by the ignore
// files of its directory and of each parent up to the repository boundary,
// where a deeper file and a later rule win and `.git/info/exclude` ranks
// below the `.gitignore` beside it.
func (g *ignorer) ignored(path string, isDir bool) bool {
	if rel, err := filepath.Rel(g.cwd, path); err == nil && !strings.HasPrefix(rel, "..") {
		if matchAny(g.patterns, filepath.ToSlash(rel)) {
			return true
		}
	}
	ignored := false
	for _, dir := range g.chain(filepath.Dir(path)) {
		for _, list := range g.listsIn(dir) {
			if decided, result := list.match(path, isDir); decided {
				ignored = result
			}
		}
	}
	return ignored
}

// chain is dir and its parents, outermost first, stopping at the directory
// that holds `.git` or `.jj`; without one, at the filesystem root.
func (g *ignorer) chain(dir string) []string {
	var dirs []string
	for {
		dirs = append(dirs, dir)
		if isVCSRoot(dir) {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	for i, j := 0, len(dirs)-1; i < j; i, j = i+1, j-1 {
		dirs[i], dirs[j] = dirs[j], dirs[i]
	}
	return dirs
}

func isVCSRoot(dir string) bool {
	for _, marker := range []string{".git", ".jj"} {
		if _, err := os.Lstat(filepath.Join(dir, marker)); err == nil {
			return true
		}
	}
	return false
}

func (g *ignorer) listsIn(dir string) []*ignoreList {
	if lists, ok := g.lists[dir]; ok {
		return lists
	}
	var lists []*ignoreList
	if exclude := gitExcludeFile(dir); exclude != "" {
		if text, err := os.ReadFile(exclude); err == nil {
			lists = append(lists, parseIgnore(dir, string(text)))
		}
	}
	for _, name := range g.names {
		if text, err := os.ReadFile(filepath.Join(dir, name)); err == nil {
			lists = append(lists, parseIgnore(dir, string(text)))
		}
	}
	g.lists[dir] = lists
	return lists
}

// gitExcludeFile is dir's `.git/info/exclude`, following a worktree's
// `.git` file to its gitdir; "" when dir is not a repository root.
func gitExcludeFile(dir string) string {
	git := filepath.Join(dir, ".git")
	info, err := os.Stat(git)
	if err != nil {
		return ""
	}
	if !info.IsDir() {
		text, err := os.ReadFile(git)
		if err != nil {
			return ""
		}
		target, ok := strings.CutPrefix(strings.TrimSpace(string(text)), "gitdir:")
		if !ok {
			return ""
		}
		git = strings.TrimSpace(target)
		if !filepath.IsAbs(git) {
			git = filepath.Join(dir, git)
		}
	}
	return filepath.Join(git, "info", "exclude")
}

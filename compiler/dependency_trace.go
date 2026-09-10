package compiler

import (
	"path/filepath"
	"strings"
)

func validDependencyTrace(trace *DependencyTrace, requested bool, root string) bool {
	if !requested {
		return trace == nil
	}
	if trace == nil || trace.Files == nil || trace.Directories == nil || len(trace.Files)+len(trace.Directories) > 8192 {
		return false
	}
	bytes := 0
	for _, paths := range [][]string{trace.Files, trace.Directories} {
		previous := ""
		for _, name := range paths {
			bytes += len(name)
			if bytes > 2*1024*1024 || len(name) > 16*1024 || strings.ContainsAny(name, "\x00\\") ||
				!filepath.IsAbs(name) || filepath.ToSlash(filepath.Clean(name)) != name || compareProtocolUTF16(previous, name) >= 0 {
				return false
			}
			if root != "" {
				relative, err := filepath.Rel(root, name)
				if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
					return false
				}
			}
			previous = name
		}
	}
	return true
}

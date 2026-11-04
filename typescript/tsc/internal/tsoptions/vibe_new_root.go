package tsoptions

import (
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfsmatch"
)

// IncludesNewFile reports whether fileName, a file that is not written yet,
// becomes one of this config's root files once it is: an include spec matches
// it and no exclude spec does, as file-name enumeration decides for a file on
// disk. vibelang --fix uses it for the sibling .ts modules it creates, which a
// composite project must list (TS6307).
func (p *ParsedCommandLine) IncludesNewFile(fileName tspath.RootedFilePath) bool {
	specs := p.getConfigFileSpecs()
	if specs == nil || specs.getMatchedIncludeSpec(fileName, p.baseDirectory, p.caseSensitivity) == "" {
		return false
	}
	if len(specs.validatedExcludeSpecs) != 0 {
		if exclude := vfsmatch.NewSpecMatcher(specs.validatedExcludeSpecs, p.baseDirectory, vfsmatch.UsageExclude, p.caseSensitivity); exclude != nil && exclude.MatchFileName(fileName) {
			return false
		}
	}
	return true
}

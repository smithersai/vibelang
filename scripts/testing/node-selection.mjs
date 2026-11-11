// Exact top-level names for files that exceed the per-target budget.
const special = new Set("\\^$.*+?()[]{}|")
export const testNamePattern = names => "^(?:" + names.map(name =>
  [...name].map(char => special.has(char) ? "\\" + char : char).join("")).join("|") + ")(?![\\s\\S])"
export const nodeTestSelection = names => names === undefined ? "" :
  "--test-name-pattern='" + testNamePattern(names).replaceAll("'", "'\\''") + "' "

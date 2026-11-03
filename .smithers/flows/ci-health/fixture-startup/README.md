# Process startup fixture

These are cuts of two real CI runs of the runtime build target, with run names
changed. The target's declared key is identical: one attempt failed during
process startup, and another ran successfully. The target records retain their
original statuses, keys and durations. Only that target is retained from each
run; unrelated targets and host paths are omitted. 
The startup failure is on the target's summary line. It has no failing test name.
The eval must report its cause as `process startup` and recommend inspecting
startup handling rather than changing a test's deadline.

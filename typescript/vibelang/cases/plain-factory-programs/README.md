S3-3: a plain local factory returns a cold program stored in an Effect-typed
local. Its call in a running body must yield the program and use its success,
including when another plain factory is called inside the program. The runtime
result proves both calls run and each subsequent invocation of the D262 stored
program runs again; importing the stored program runs nothing. `useIt` also
pins body classification when the factory call is the only Effect operation.
The plain generic `identity` also runs its Effect-valued instantiated result.

The companion `.fail` case pins EK1001 for unannotated top-level construction,
EK9203 for running a factory result under a plain contract, and EK9201/EK9202
for the returned program's failure and requirement channels.

Emitter audit:
- `plan.go:runs` returned a local callee's plain form without inspecting its
  returned program. Fixed by falling through to the shared D24 result predicate.
- `plain.go:candidateCallee` treated every call of a plain generic as inline,
  even when its instantiated result is an Effect. It now checks the call type.
- `failures.go:addCall` and `recursion.go:bodyCallees` also assumed a running
  local call gets E/R from the callee body. Plain factories now read result E/R.
- `lower.go:visit` and `byNameProgram`, and `plain_lower.go:visitDirectReference`,
  bypass yield for a planned `$direct` call. This is the D10 optimization: that
  variant already returns A, so yielding it would be wrong.
- `scopes_lower.go:acquisition` defers an outer running call to `$using`, and
  `datamethods.go:visitModuleMethodCall` adds yield after its module-method
  rewrite. Both consume the shared run plan; neither reclassifies by callee form.

D24, D147 and D262 already specify the fixed behavior; no decision changes.

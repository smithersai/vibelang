# Rest and tuple-rest parameters admit throwing callbacks by element

PREVIEW-10 (rev-preview pass 59): a callback passed where the parameter's
function type has `@throws` may hold calls known to throw, because those
throws belong to the receiving call. The parameter is the argument's effective
one: for `...fs: Reader[]` every argument at or after the rest position takes
`Reader`, and for `...fs: [Reader, Plain]` each argument takes the tuple
member at its position. Before the fix, the check read the whole rest
parameter's type, which has no call signature, so a callback in any rest
position was `EK0401`.

No diagnostic: the first and a later rest position, a rest after a fixed
parameter, the tuple member typed `Reader`, a fixed `Reader` parameter.
`EK0401`: the tuple member typed `Plain` (no `@throws`) and a fixed `Plain`
parameter.

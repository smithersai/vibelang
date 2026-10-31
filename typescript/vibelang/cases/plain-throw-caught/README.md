# Plain functions catch what reaches them

A plain function may throw what its own catch handles, and it still returns a
value. Its try statement is JavaScript's (detail 205), so the catch also receives
a TypeScript function's exception. A trusted call's exception outside a try
reaches the caller unchanged. Under an Effect contract the
same throws, in a statement, a match arm, a do block, or a conditional, fail
the Effect.

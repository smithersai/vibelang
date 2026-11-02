// Native ECMA-262 TryStatement, StatementList and LabelledEvaluation oracle, as pinned by VIP-2.
export const vectors = [
  [
    "local-break",
    "label: { try { 1; } finally { 2; break label; } }",
    2
  ],
  [
    "empty-break",
    "label: { try { 1; } finally { break label; } }",
    null
  ],
  [
    "catch-break",
    "label: { try { throw 0; } catch { 4; } finally { 5; break label; } }",
    5
  ],
  [
    "nested-finalizers",
    "label: { try { 1; } finally { try { 2; } finally { 99; } 3; break label; } }",
    3
  ],
  [
    "normal-finalizer",
    "try { 1; } finally { 2; }",
    1
  ],
  [
    "empty-normal-finalizer",
    "try { 1; } finally {}",
    1
  ],
  [
    "normal-catch-finalizer",
    "try { throw 0; } catch { 4; } finally { 5; }",
    4
  ],
  [
    "empty-catch-break",
    "label: { try { throw 0; } catch { 4; } finally { break label; } }",
    null
  ],
  [
    "nested-abrupt-finalizer",
    "label: { try { 1; } finally { try { 2; } finally { 3; break label; } } }",
    3
  ],
  [
    "nested-empty-abrupt",
    "label: { try { 1; } finally { 9; try { 2; } finally { break label; } } }",
    null
  ],
  [
    "internal-break-finishes-normally",
    "try { 1; } finally { inner: { 2; break inner; } }",
    1
  ],
  [
    "try-break-normal-finalizer",
    "label: { try { 1; break label; } finally { 2; } }",
    1
  ],
  [
    "try-break-overridden",
    "label: { try { 1; break label; } finally { 2; break label; } }",
    2
  ],
  [
    "empty-try-normal-finalizer",
    "7; try {} finally { 9; }",
    null
  ],
  [
    "empty-if-abrupt",
    "label: { try { 1; } finally { 2; if (true) { break label; } } }",
    null
  ],
  [
    "direct-if-break",
    "label: { try { 1; } finally { 2; if (true) break label; else 0; } }",
    null
  ],
  [
    "loop-body-break",
    "label: { try { 1; } finally { 2; while (true) break label; } }",
    null
  ],
  [
    "switch-clause-break",
    "label: { try { 1; } finally { switch (0) { case 0: 5; break label; } } }",
    5
  ],
  [
    "labeled-body-break",
    "label: { try { 1; } finally { inner: break label; } }",
    null
  ],
  [
    "internal-continue",
    "try { 1; } finally { for (let i = 0; i < 2; i++) { 9; continue; } }",
    1
  ]
];
export function completion(source: string): unknown { return eval(source); }

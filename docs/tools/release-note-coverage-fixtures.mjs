// Public fixes omitted from the 0.0.11 release list; source commits are audit provenance.
export const targetRelease = "0.0.11"
export const coverage = [
  {
    "key": "example-release-age",
    "note": "Bun's release-age setting blocked newly published VibeLang packages in example projects; the examples now exempt their pinned VibeLang packages from that age check.",
    "needles": [
      "release-age setting blocked newly published"
    ],
    "fixes": [
      "de86dbec44a8"
    ]
  },
  {
    "key": "annotation-preflight",
    "note": "Editor fixes could write invalid annotations around `this` or `super`, a loop binding or a `finally` binding; they now decline edits that cannot preserve the program.",
    "needles": [
      "invalid annotations around"
    ],
    "fixes": [
      "ce13e86b0728"
    ]
  },
  {
    "key": "hover-reference-sites",
    "note": "Hover and rename missed references in match guards, `is` subjects, `and` patterns and error `extends` clauses; the editor now finds those original source references.",
    "needles": [
      "hover and rename missed references in match guards"
    ],
    "fixes": [
      "ce13e86b0728",
      "98a7adcfe258"
    ]
  },
  {
    "key": "catch-outline-ranges",
    "note": "An unfinished `catch` expression could produce document-outline ranges that ended before they started; outline entries now keep valid source ranges.",
    "needles": [
      "document-outline ranges that ended before"
    ],
    "fixes": [
      "ce13e86b0728"
    ]
  },
  {
    "key": "empty-setting-errors",
    "note": "Empty setting names or empty diagnostic keys in legacy compiler configuration could be silently ignored; they now report a configuration error.",
    "needles": [
      "empty setting names or empty diagnostic keys"
    ],
    "fixes": [
      "2a579f6bd5db"
    ]
  },
  {
    "key": "unclosed-module-error",
    "note": "An unfinished module declaration could crash the parser; it now reports syntax errors.",
    "needles": [
      "unfinished module declaration could crash"
    ],
    "fixes": [
      "f2534cab3172"
    ]
  },
  {
    "key": "incomplete-node-crashes",
    "note": "An unfinished variable initializer or `catch` annotation could crash diagnostics or quick fixes; syntax errors now remain reported and unsafe rewrites are declined.",
    "needles": [
      "unfinished variable initializer or catch annotation"
    ],
    "fixes": [
      "e8c9db343d92"
    ]
  },
  {
    "key": "repeated-fix-flag",
    "note": "`vibelang --fix --fix` reported `TS5023` instead of fixing the project; repeated `--fix` flags now apply the fixes once.",
    "needles": [
      "vibelang --fix --fix reported ts5023"
    ],
    "fixes": [
      "2589db5185e2"
    ]
  },
  {
    "key": "throwing-helper-guidance",
    "note": "The migration instructions omitted throwing synchronous helpers; they now explain when to use an expected failure, a defect or a retained TypeScript helper.",
    "needles": [
      "migration instructions omitted throwing synchronous helpers"
    ],
    "fixes": [
      "2009300315a7"
    ]
  },
  {
    "key": "pnpm-selector-patches",
    "note": "The migrate flow's Effect upgrade left versioned pnpm selectors and patch metadata on the old release; matching selectors, patch filenames and `package.json` version references now move together while unrelated settings stay intact.",
    "needles": [
      "left versioned pnpm selectors and patch metadata"
    ],
    "fixes": [
      "ab9e2c42b39c"
    ]
  },
  {
    "key": "bun-setup-issues",
    "note": "When migration setup broke a Bun test suite, it threw before recording what failed; setup now records an issue with both exit statuses and the before-and-after logs.",
    "needles": [
      "migration setup broke a bun test suite"
    ],
    "fixes": [
      "f5d3eaa022eb"
    ]
  },
  {
    "key": "span-argument-guidance",
    "note": "Migration instructions recommended a retired block-parameter form for tracing; they now show a program argument passed to `withSpan`.",
    "needles": [
      "retired block-parameter form for tracing"
    ],
    "fixes": [
      "b00cbd304da9"
    ]
  },
  {
    "key": "any-recovery-warning",
    "note": "A call to a missing name or missing member could add a misleading warning about calling `any`; it now reports the original TypeScript error without that warning, while genuine `any` calls still warn.",
    "needles": [
      "missing name or missing member could add a misleading warning"
    ],
    "fixes": [
      "148c1c254b8d"
    ]
  },
  {
    "key": "using-cleanup-registration",
    "note": "An interruption after `using` received a resource could arrive before its cleanup was registered; cleanup registration now completes before that interruption can escape.",
    "needles": [
      "interruption after using received a resource"
    ],
    "fixes": [
      "73ab33d25681"
    ]
  }
]

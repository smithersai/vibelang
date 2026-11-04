import * as Data from "effect/Data"
namespace Case0 { 
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly ["_tag"]:string}}>
}

namespace Case1 { 
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly ['_tag']:string}}>
}

namespace Case2 { 
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly ["\u005ftag"]:string}}>
}

namespace Case3 { const key="_tag";
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly [key]:string}}>
}

namespace Case4 { const key="_tag" as const;
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly [key]:string}}>
}

namespace Case5 { const names={tag:"_tag"} as const;
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly [names.tag]:string}}>
}

namespace Case6 { 
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly ["_tag"]?:string}}>
}

namespace Case7 { 
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly ['_tag']?:string}}>
}

namespace Case8 { 
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly ["\u005ftag"]?:string}}>
}

namespace Case9 { const key="_tag";
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly [key]?:string}}>
}

namespace Case10 { const key="_tag" as const;
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly [key]?:string}}>
}

namespace Case11 { const names={tag:"_tag"} as const;
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly [names.tag]?:string}}>
}

namespace Case12 { enum Key { Tag="_tag" };
export type D=Data.TaggedEnum<{A:{readonly [Key.Tag]:string}}>
}

namespace Case13 { declare const key:string;
// @ts-expect-error TS2344: native TaggedEnum forbids this payload key.
export type D=Data.TaggedEnum<{A:{readonly [key]:string}}>
}

namespace Case14 { declare const key:unique symbol;
export type D=Data.TaggedEnum<{A:{readonly [key]:string}}>
}

namespace Case15 { const key="field";
export type D=Data.TaggedEnum<{A:{readonly [key]:string}}>
}

namespace Case16 { const key="_tag";
// @ts-expect-error TS1170: native type-member key shape is invalid.
export type D=Data.TaggedEnum<{A:{readonly [(key)]:string}}>
}

namespace Case17 { const names={tag:"_tag"} as const;
// @ts-expect-error TS1170: native type-member key shape is invalid.
export type D=Data.TaggedEnum<{A:{readonly [names["tag"]]:string}}>
}

namespace Case18 { function key():"_tag"{return "_tag"}
// @ts-expect-error TS1170: native type-member key shape is invalid.
export type D=Data.TaggedEnum<{A:{readonly [key()]:string}}>
}

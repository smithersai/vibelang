export {}
declare global {
 interface String { readonly _tag: "Only" }
 interface Number { readonly _tag: "Only" }
 interface Boolean { readonly _tag: "Only" }
 interface BigInt { readonly _tag: "Only" }
 interface Symbol { readonly _tag: "Only" }
}
declare const A: unique symbol
declare const B: unique symbol
export function strings(s:"a"|"b"|{_tag:"Only"}){if((typeof s==="object"||typeof s==="function")&&s!==null&&"_tag" in s&&s._tag==="Only")return 1;const remaining:never=s;return remaining;}
export function numbers(s:1|2|{_tag:"Only"}){if((typeof s==="object"||typeof s==="function")&&s!==null&&"_tag" in s&&s._tag==="Only")return 1;const remaining:never=s;return remaining;}
export function booleans(s:boolean|{_tag:"Only"}){if((typeof s==="object"||typeof s==="function")&&s!==null&&"_tag" in s&&s._tag==="Only")return 1;const remaining:never=s;return remaining;}
export function bigints(s:1n|2n|{_tag:"Only"}){if((typeof s==="object"||typeof s==="function")&&s!==null&&"_tag" in s&&s._tag==="Only")return 1;const remaining:never=s;return remaining;}
export function symbols(s:typeof A|typeof B|{_tag:"Only"}){if((typeof s==="object"||typeof s==="function")&&s!==null&&"_tag" in s&&s._tag==="Only")return 1;const remaining:never=s;return remaining;}

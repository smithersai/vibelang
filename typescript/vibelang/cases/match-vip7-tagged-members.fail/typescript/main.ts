const A:unique symbol=Symbol();const B:unique symbol=Symbol();
interface IA{_tag:"A"};interface IB{_tag:"B"};
class CA{readonly _tag="A" as const};class CB{readonly _tag="B" as const};
function symbols(s:{_tag:typeof A}|{_tag:typeof B}){if(false)return 0;const left:never=s;return 0}
function interfaces(s:IA|IB){if(s._tag==="A")return 1;const left:never=s;return 0}
function classes(s:CA|CB){if(s._tag==="A")return 1;const left:never=s;return 0}
export {}

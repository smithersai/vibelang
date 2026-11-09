export function literalLeft(s:string):"spec" | "none" {if(s === "spec"){const x=s;return x;}return "none";}
export function literalRight(s:string):"spec" | "none" {if(s === "spec"){const x=s;return x;}return "none";}
export function unionLeft(s:string):"spec" | "tasks" | "none" {if(s === "spec" || s === "tasks"){const x=s;return x;}return "none";}
export function unionRight(s:string):"spec" | "tasks" | "none" {if(s === "spec" || s === "tasks"){const x=s;return x;}return "none";}
export function arrayLeft(s:string[]):"spec" | "tasks" | "none" {if(s.length === 1 && (s[0] === "spec" || s[0] === "tasks")){const x=s[0];return x;}return "none";}
export function arrayRight(s:string[]):"spec" | "tasks" | "none" {if(s.length === 1 && (s[0] === "spec" || s[0] === "tasks")){const x=s[0];return x;}return "none";}
export function nested(s:string):"tasks" | "none" {if((s === "spec" || s === "tasks") && s === "tasks"){const x=s;return x;}return "none";}
export function nonNarrowing(s:string):string | "none" {if(true){const x=s;return x;}return "none";}

type Shape={_tag:"Square";side:number}|{_tag:"Rect";side:number}|{_tag:"Circle";radius:number}
export function objectOrLeft(s:Shape):number{if(s._tag==="Square"||s._tag==="Rect"){const x=s;return x.side}return 0}
export function objectOrRight(s:Shape):number{if(s._tag==="Square"||s._tag==="Rect"){const x=s;return x.side}return 0}
export function freshGuard():number{let n=2;if(n===1)return n;return 0}

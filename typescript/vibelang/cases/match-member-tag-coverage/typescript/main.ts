enum E { A, B }
function shared(s:{_tag:"A";x:number}|{_tag:"A";y:number}) { switch(s._tag) {case "A":return 1;} throw new TypeError() }
function union(s:{_tag:"A"|"B"}|{_tag:"C"}) { switch(s._tag) {case "A":return 1;case "B":return 2;case "C":return 3;} throw new TypeError() }
function number(s:{_tag:1|2}) { switch(s._tag) {case 1:return 1;case 2:return 2;} throw new TypeError() }
function bigint(s:{_tag:1n|2n}) { switch(s._tag) {case 1n:return 1;case 2n:return 2;} throw new TypeError() }
function boolean(s:{_tag:boolean}) { switch(s._tag) {case true:return 1;case false:return 2;} throw new TypeError() }
function undefinedTag(s:{_tag:undefined}) { switch(s._tag) {case undefined:return 0;} throw new TypeError() }
function enumTag(s:{_tag:E}) { switch(s._tag) {case E.A:return 1;case E.B:return 2;} throw new TypeError() }
export function main(){ return [shared({_tag:"A",x:1}),shared({_tag:"A",y:2}),union({_tag:"A"}),union({_tag:"B"}),union({_tag:"C"}),number({_tag:1}),number({_tag:2}),bigint({_tag:1n}),bigint({_tag:2n}),boolean({_tag:true}),boolean({_tag:false}),undefinedTag({_tag:undefined}),enumTag({_tag:E.A}),enumTag({_tag:E.B})] }

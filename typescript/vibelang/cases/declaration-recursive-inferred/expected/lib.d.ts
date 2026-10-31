export declare const from: (value: string) => {
    state: {
        value: string;
    };
    named: (value: string) => /*elided*/ any;
};
declare const makeBuilder: (state: {
    value: string;
}) => {
    state: {
        value: string;
    };
    named: (value: string) => /*elided*/ any;
};
export type Builder = ReturnType<typeof makeBuilder>;
export declare const start: () => {
    n: number;
    next: () => {
        n: number;
        back: () => /*elided*/ any;
    };
};
export declare function chain(count: number): {
    count: number;
    more(): /*elided*/ any;
};
export {};

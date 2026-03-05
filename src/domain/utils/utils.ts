import {Option} from "effect";

export type Maybe<T> = Option.Option<T> | null | undefined;

export const normalizeMaybe = <T>(value: Maybe<T>): Option.Option<T> => {
    if (value === null || value === undefined) {
        return Option.none();
    }
    if (Option.isOption(value)) {
        return value;
    }
    return Option.some(value);
    };

export const optionToMaybe = <T>(option: Option.Option<T>): Maybe<T> => {
    return Option.getOrNull(option) as Maybe<T>;
};

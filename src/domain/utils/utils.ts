import { Option as O } from "effect";

export type Maybe<T> = T | O.Option<T> | null | undefined;

export const normalizeMaybe = <T>(value: Maybe<T>): O.Option<T> => {
  if (value === null || value === undefined) {
    return O.none();
  }
  if (O.isOption(value)) {
    return value;
  }
  return O.some(value);
};

export const optionToMaybe = <T>(option: O.Option<T>): Maybe<T> => {
  return O.getOrNull(option) as Maybe<T>;
};

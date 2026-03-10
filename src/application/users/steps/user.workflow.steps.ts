import { makeDecoder } from "@application/shared/decode.ts";
import { UserWorkflowError } from "../user-workflow.errors.ts";
import type { UserDTO, JwtClaims } from "../dtos/user.dto.ts";

/** Decode a raw input against a schema, mapping parse errors to InvalidInput. */
export const decode = makeDecoder(UserWorkflowError.invalidInput);

/** Result returned by the login workflow. */
export type LoginResult = {
  readonly claims: JwtClaims;
  readonly user: UserDTO;
};

import type { ZodError } from "zod";

// Shared shape for Server Action results consumed via useActionState.
export type FormState = {
  ok?: boolean;
  error?: string;
  message?: string;
};

export function zodErrorMessage(error: ZodError): string {
  return error.issues.map((i) => i.message).join(" ");
}

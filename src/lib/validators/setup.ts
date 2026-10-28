import { z } from "zod";
import { passwordSchema } from "./auth";

export const firstAdminSchema = z
  .object({
    email: z.string().email("Enter a valid email."),
    name: z.string().trim().optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

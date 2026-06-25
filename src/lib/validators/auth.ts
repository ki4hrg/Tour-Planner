import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Admin-set passwords (no self-service email reset in v1).
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.");

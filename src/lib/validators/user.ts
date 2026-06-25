import { z } from "zod";
import { passwordSchema } from "./auth";

export const roleSchema = z.enum(["ADMIN", "PLANNER", "VIEWER"]);

export const createUserSchema = z.object({
  email: z.string().email("Enter a valid email."),
  name: z.string().trim().optional(),
  password: passwordSchema,
  role: roleSchema,
});

export const resetPasswordSchema = z.object({
  userId: z.string().min(1),
  password: passwordSchema,
});

export const updateRoleSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
});

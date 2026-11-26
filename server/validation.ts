import { z } from "zod";

export const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(50_000),
  language: z.string().trim().max(50).default("auto"),
  durationMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).default(0),
});

export const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    text: z.string().trim().min(1).max(50_000).optional(),
  })
  .refine((v) => v.title !== undefined || v.text !== undefined, {
    message: "Provide title or text",
  });

export const idSchema = z.coerce.number().int().positive();

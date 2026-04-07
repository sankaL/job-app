import { z } from "zod";

const envSchema = z.object({
  VITE_APP_ENV: z.string().default("development"),
  VITE_APP_DEV_MODE: z
    .string()
    .transform((value) => value === "true")
    .default("false"),
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  VITE_API_URL: z.string().url(),
});

export const env = envSchema.parse(import.meta.env);

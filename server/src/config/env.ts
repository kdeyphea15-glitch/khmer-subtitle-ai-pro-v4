import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  CLIENT_ORIGIN: z.string().optional(),
  CLIENT_ORIGINS: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

const clientOrigins = [
  parsed.data.CLIENT_ORIGIN,
  ...(parsed.data.CLIENT_ORIGINS?.split(",") ?? [])
]
  .map((origin) => origin?.trim())
  .filter((origin): origin is string => Boolean(origin));

export const env = {
  ...parsed.data,
  clientOrigins
};

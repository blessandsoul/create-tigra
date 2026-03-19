import { z } from 'zod';

// Every field MUST have a .default() so the dev fallback (envSchema.parse({}))
// can produce valid defaults when env vars are missing in development.
const envSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z
    .string()
    .url('NEXT_PUBLIC_API_BASE_URL must be a valid URL')
    .default('http://localhost:8000/api/v1'),
  NEXT_PUBLIC_APP_NAME: z.string().default('My App'),
});

function validateEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse({
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  });

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(`\n❌ Invalid environment variables:\n${formatted}\n`);

    // In production, fail hard. In development, warn but continue with defaults.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invalid environment variables');
    }
  }

  return result.success ? result.data : envSchema.parse({});
}

export const env = validateEnv();

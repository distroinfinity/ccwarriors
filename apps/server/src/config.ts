import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(8080),
});

export interface Config {
  databaseUrl: string;
  port: number;
}

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.parse(env);
  return { databaseUrl: parsed.DATABASE_URL, port: parsed.PORT };
}

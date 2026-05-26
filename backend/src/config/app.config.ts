// src/config/app.config.ts
// Centralised typed config — consumed via ConfigService everywhere

export interface AppConfig {
  port: number;
  nodeEnv: string;
  jwt: {
    secret: string;
    expiresIn: string;
  };
  cors: {
    origins: string[];
  };
  db: {
    type: string;
    name: string;
  };
}

export const appConfig = (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  },
  db: {
    type: process.env.DB_TYPE ?? 'sqlite',
    name: process.env.DB_NAME ?? 'doclens.db',
  },
});

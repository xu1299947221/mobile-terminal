import type { User } from "@mobile-terminal/shared";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
    sessionId?: string;
  }
}


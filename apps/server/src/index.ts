import path from "node:path";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import { config, validateConfig, webDistDir } from "./config.js";
import { migrate } from "./db.js";
import { registerAuth } from "./auth.js";
import { handleError, registerRoutes } from "./routes.js";
import { registerSecurity } from "./security.js";
import { registerTerminalWs } from "./terminal-ws.js";

async function main() {
  validateConfig();
  migrate();
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  app.decorate("configCookieName", config.cookieName);
  app.setErrorHandler((error, _request, reply) => {
    handleError(error, reply);
  });
  await app.register(cookie, {
    secret: config.cookieSecret
  });
  await app.register(formbody);
  await app.register(websocket, {
    options: {
      maxPayload: 1024 * 1024
    }
  });
  await registerSecurity(app);
  await registerAuth(app);
  await registerTerminalWs(app);
  await registerRoutes(app);

  app.get("/manifest.webmanifest", async (_request, reply) => {
    return readFile(path.join(webDistDir, "manifest.webmanifest")).then((body) =>
      reply.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0").type("application/manifest+json").send(body)
    );
  });

  app.get("/sw.js", async (_request, reply) => {
    return readFile(path.join(webDistDir, "sw.js")).then((body) =>
      reply.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0").type("application/javascript; charset=utf-8").send(body)
    );
  });

  app.get<{ Params: { name: string } }>("/icon-:name.png", async (request, reply) => {
    const name = request.params.name;
    if (!/^\d+$/.test(name)) {
      reply.code(404).send({ error: "not_found", message: "图标不存在" });
      return;
    }
    return readFile(path.join(webDistDir, `icon-${name}.png`)).then((body) =>
      reply.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0").type("image/png").send(body)
    );
  });

  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: "/",
    decorateReply: false,
    setHeaders: (response, filePath) => {
      if (filePath.endsWith("sw.js") || filePath.endsWith("manifest.webmanifest") || /icon-\d+\.png$/.test(filePath)) {
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      }
    }
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api") || request.raw.url?.startsWith("/ws")) {
      reply.code(404).send({ error: "not_found", message: "接口不存在" });
      return;
    }
    return readFile(path.join(webDistDir, "index.html"), "utf8").then((html) => reply.type("text/html; charset=utf-8").send(html));
  });

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

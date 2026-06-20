import { mkdirSync } from "node:fs";
import path from "node:path";

const defaultCookieSecret = "dev-cookie-secret-change-me";

export const rootDir = process.env.MOBILE_TERMINAL_ROOT ?? path.resolve(process.cwd(), "../..");
export const dataDir = process.env.MOBILE_TERMINAL_DATA ?? path.join(rootDir, "data");
export const webDistDir = process.env.MOBILE_TERMINAL_WEB_DIST ?? path.join(rootDir, "apps/web/dist");

mkdirSync(dataDir, { recursive: true });

export const config = {
  host: process.env.MOBILE_TERMINAL_HOST ?? "127.0.0.1",
  port: Number(process.env.MOBILE_TERMINAL_PORT ?? "3020"),
  cookieName: "mt_session",
  cookieSecret: process.env.MOBILE_TERMINAL_COOKIE_SECRET ?? defaultCookieSecret,
  databasePath: process.env.MOBILE_TERMINAL_DB ?? path.join(dataDir, "app.db"),
  ttydPortStart: Number(process.env.MOBILE_TERMINAL_TTYD_PORT_START ?? "19000"),
  ttydPortEnd: Number(process.env.MOBILE_TERMINAL_TTYD_PORT_END ?? "19999"),
  publicOrigin: process.env.MOBILE_TERMINAL_PUBLIC_ORIGIN ?? "https://terminal.example.com",
  isProduction: process.env.NODE_ENV === "production"
};

export function validateConfig(): void {
  if (config.isProduction && config.cookieSecret === defaultCookieSecret) {
    throw new Error("生产环境必须设置 MOBILE_TERMINAL_COOKIE_SECRET");
  }
  if (config.isProduction && config.cookieSecret.length < 32) {
    throw new Error("MOBILE_TERMINAL_COOKIE_SECRET 至少需要 32 个字符");
  }
}

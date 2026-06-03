import http from "node:http";
import { URL } from "node:url";
import open from "open";
import pc from "picocolors";
import { saveConfig, type Config } from "./config.js";

const LOGIN_TIMEOUT_MS = 2 * 60 * 1000;

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claude Warriors — Enlisted</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0;
           background: #0d1117; color: #e6edf3; }
    .card { text-align: center; padding: 2rem 3rem; border: 1px solid #30363d;
            border-radius: 12px; background: #161b22; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    p  { color: #8b949e; }
  </style>
</head>
<body>
  <div class="card">
    <h1>&#9876; Enlisted</h1>
    <p>You can close this tab and return to your terminal.</p>
  </div>
</body>
</html>`;

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Claude Warriors — Error</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0;
           background: #0d1117; color: #e6edf3; }
    .card { text-align: center; padding: 2rem 3rem; border: 1px solid #f85149;
            border-radius: 12px; background: #161b22; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #f85149; }
    p  { color: #8b949e; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Auth Error</h1>
    <p>${message}</p>
    <p>Close this tab and try again.</p>
  </div>
</body>
</html>`;
}

export async function runLoginFlow(apiBase: string): Promise<Config> {
  return new Promise<Config>((resolve, reject) => {
    let settled = false;

    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const url = new URL(req.url, "http://127.0.0.1");
      const token = url.searchParams.get("token");
      const login = url.searchParams.get("login");
      const error = url.searchParams.get("error");

      if (error || !token || !login) {
        const msg = error ?? "Missing token or login in callback";
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(errorHtml(msg));
        server.close();
        if (!settled) {
          settled = true;
          reject(new Error(`Login failed: ${msg}`));
        }
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SUCCESS_HTML);
      server.close();

      if (!settled) {
        settled = true;
        resolve({ token, login });
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not bind to a loopback port"));
        return;
      }

      const port = addr.port;
      const authUrl = `${apiBase}/cli/auth?port=${port}`;

      console.log(pc.cyan(`Opening browser for GitHub OAuth…`));
      console.log(pc.dim(`  ${authUrl}`));

      open(authUrl).catch(() => {
        console.log(pc.yellow(`Couldn't open browser automatically. Visit:`));
        console.log(pc.bold(`  ${authUrl}`));
      });
    });

    const timer = setTimeout(() => {
      server.close();
      if (!settled) {
        settled = true;
        reject(
          new Error(
            "Login timed out after 2 minutes. Run `npx claude-warriors login` to try again."
          )
        );
      }
    }, LOGIN_TIMEOUT_MS);

    // Don't keep the process alive just for the timer
    timer.unref();
  }).then(async (config) => {
    await saveConfig(config);
    console.log(pc.green(`\n⚔️  Enlisted as ${pc.bold(config.login)}!\n`));
    return config;
  });
}

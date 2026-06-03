// Zero-dependency terminal colors + browser opener.
import { spawn } from "node:child_process";

const tty = process.stdout.isTTY === true;
const wrap = (open: number, close: number) => (s: string) =>
  tty ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const underline = wrap(4, 24);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);

export function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    const [cmd, args]: [string, string[]] =
      platform === "darwin"
        ? ["open", [url]]
        : platform === "win32"
          ? ["cmd", ["/c", "start", "", url]]
          : ["xdg-open", [url]];
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

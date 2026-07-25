import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ProviderError } from "./types.js";

const execFileAsync = promisify(execFile);

export function validateMessage(message: string): string {
  const value = (message || "").trim();
  if (!value) throw new ProviderError("Message is empty.");
  if (value.length > 100_000) throw new ProviderError("Message is too long (maximum 100,000 characters).");
  return value;
}

export function validateCwd(cwd: string): string {
  const target = cwd?.trim() || homedir();
  try {
    if (!statSync(target).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new ProviderError(`Working directory not found: ${target}`);
  }
  return target;
}

export function resolveExecutable(command: string): string | null {
  if (isAbsolute(command)) return existsSync(command) ? command : null;
  for (const root of (process.env.PATH || "").split(delimiter)) {
    if (!root) continue;
    const candidate = join(root, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function executableVersion(command: string): Promise<string | undefined> {
  const executable = resolveExecutable(command);
  if (!executable) return undefined;
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["--version"], {
      timeout: 4_000,
      maxBuffer: 32_000,
    });
    return `${stdout}${stderr}`.trim().split("\n")[0] || undefined;
  } catch {
    return undefined;
  }
}

export async function executableJson(
  command: string,
  args: string[],
): Promise<Record<string, unknown> | null> {
  const executable = resolveExecutable(command);
  if (!executable) return null;
  try {
    const { stdout } = await execFileAsync(executable, args, {
      timeout: 4_000,
      maxBuffer: 32_000,
    });
    const parsed = JSON.parse(stdout) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

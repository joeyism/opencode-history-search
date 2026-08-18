import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEARCH_PROCESS_ARG = "--opencode-history-search-process";

interface SearchProcessRequest<Args> {
  type: "search";
  args: Args;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

type SearchProcessResponse =
  | { type: "result"; value: string }
  | { type: "error"; error: SerializedError };

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { name: "Error", message: String(error) };
}

function deserializeError(error: SerializedError): Error {
  const deserialized = new Error(error.message);
  deserialized.name = error.name;
  deserialized.stack = error.stack;
  return deserialized;
}

function scriptPath(scriptUrl: string | URL): string {
  if (scriptUrl instanceof URL || scriptUrl.startsWith("file:")) {
    return fileURLToPath(scriptUrl);
  }
  return scriptUrl;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;

  const error = new Error(
    typeof signal.reason === "string" ? signal.reason : "History search aborted",
  );
  error.name = "AbortError";
  return error;
}

function findBunExecutable(): string | null {
  const fromPath = Bun.which("bun");
  if (fromPath) return fromPath;

  const executableName = process.platform === "win32" ? "bun.exe" : "bun";
  if (basename(process.execPath).toLowerCase() === executableName) {
    return process.execPath;
  }

  const installRoots = [process.env.BUN_INSTALL, join(homedir(), ".bun")];
  for (const root of installRoots) {
    if (!root) continue;
    const candidate = join(root, "bin", executableName);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export function isSearchProcess(): boolean {
  return process.argv.includes(SEARCH_PROCESS_ARG);
}

export async function serveSearchProcess<Args>(
  executeSearch: (args: Args) => Promise<string>,
): Promise<void> {
  let response: SearchProcessResponse;
  try {
    const request = JSON.parse(
      await Bun.stdin.text(),
    ) as SearchProcessRequest<Args>;
    if (request.type !== "search") {
      throw new Error("Invalid history search process request");
    }
    response = { type: "result", value: await executeSearch(request.args) };
  } catch (error) {
    response = { type: "error", error: serializeError(error) };
  }

  await Bun.write(Bun.stdout, JSON.stringify(response));
}

export async function runSearchInProcess<Args>(
  args: Args,
  scriptUrl: string | URL,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw abortError(signal);

  const bunPath = findBunExecutable();
  if (!bunPath) {
    throw new Error(
      "Could not find a Bun executable; add bun to PATH or set BUN_INSTALL",
    );
  }

  const proc = Bun.spawn({
    cmd: [bunPath, scriptPath(scriptUrl), SEARCH_PROCESS_ARG],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });

  const request: SearchProcessRequest<Args> = { type: "search", args };
  try {
    proc.stdin.write(JSON.stringify(request));
    proc.stdin.end();
  } catch (error) {
    proc.kill();
    throw error;
  }

  const [output, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (signal?.aborted) throw abortError(signal);
  if (exitCode !== 0) {
    const details = stderr.trim();
    throw new Error(
      details
        ? `History search process failed: ${details}`
        : `History search process exited with code ${exitCode}`,
    );
  }

  let response: SearchProcessResponse;
  try {
    response = JSON.parse(output) as SearchProcessResponse;
  } catch {
    throw new Error("History search process returned an invalid response");
  }

  if (response.type === "result") return response.value;
  throw deserializeError(response.error);
}

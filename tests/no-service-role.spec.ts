import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Runs a shell command and returns its stdout+stderr concatenated. */
function tryRun(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });
  } catch (err) {
    // grep exits 1 when no matches, which is exactly what we want.
    const e = err as { status?: number; stdout?: string; stderr?: string };
    if (e.status === 1) return e.stdout ?? "";
    throw err;
  }
}

describe("no service_role in BFF path", () => {
  it("supabase/functions never references SERVICE_ROLE_KEY", () => {
    // Anywhere the BFF touches service_role would be a tenant-scoping escape
    // hatch. The seeder is allowed to use it (that lives in supabase/seed).
    const hits = tryRun("grep", [
      "-rnI",
      "--exclude-dir=node_modules",
      "-e",
      "SERVICE_ROLE",
      "-e",
      "service_role",
      "supabase/functions",
    ]);
    expect(hits.trim()).toBe("");
  });
});

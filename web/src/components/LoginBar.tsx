import { useState } from "react";
import { SEED_USERS, loginAs, logout } from "../lib/session";

export function LoginBar({ email }: { email: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(nextEmail: string) {
    setBusy(true);
    setErr(null);
    try {
      await loginAs(nextEmail);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-slate-500">Login as:</label>
      <select
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        value={email ?? ""}
        onChange={(e) => pick(e.target.value)}
        disabled={busy}
      >
        <option value="" disabled>— pick a seed user —</option>
        {SEED_USERS.map((u) => (
          <option key={u.email} value={u.email}>{u.label}</option>
        ))}
      </select>
      {email && (
        <button
          type="button"
          onClick={() => logout()}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
        >Sign out</button>
      )}
      {err && <span className="text-sm text-red-600">{err}</span>}
    </div>
  );
}

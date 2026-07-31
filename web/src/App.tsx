import { LoginBar } from "./components/LoginBar";
import { Performance } from "./pages/Performance";
import { useSession } from "./lib/session";

export default function App() {
  const { email, ready } = useSession();
  return (
    <div className="min-h-screen text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold">cohort-lens</h1>
            <span className="text-xs text-slate-500">multi-tenant ad performance</span>
          </div>
          <LoginBar email={email} />
        </div>
      </header>
      {!ready && <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-500">loading session…</div>}
      {ready && !email && (
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            <p className="mb-2">Pick a seed user in the top-right to log in.</p>
            <p>
              All seed users share the password <code className="rounded bg-slate-100 px-1">password</code>.
              Try <b>analyst @ shared</b> to see multi-org switching in action.
            </p>
          </div>
        </div>
      )}
      {/*
        `key={email}` remounts the whole page when the signed-in user changes.
        Cheaper than threading auth invalidation into every hook: React tears
        down Performance's state (orgs list, selected org, filters) and the
        new user gets a fresh slate. Fine for a dashboard where nothing
        expensive is cached on the FE — the BFF's queryMs owns latency.
      */}
      {ready && email && <Performance key={email} />}
    </div>
  );
}

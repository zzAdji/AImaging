import { useState, type FormEvent } from "react";
import { cn } from "../lib/cn";

export function LoginScreen({
  onSubmit,
  onForgotPassword,
}: {
  /**
   * Phase Database 8 : la soumission délègue à Supabase Auth
   * (signInWithPassword). Toute erreur est déjà traduite en message clair
   * par la couche service — jamais d'exception brute affichée.
   */
  onSubmit: (email: string, password: string, remember: boolean) => Promise<void>;
  onForgotPassword?: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit(email.trim(), password, remember);
    } catch (exc: unknown) {
      setError(exc instanceof Error ? exc.message : "Connexion impossible.");
    } finally {
      setPending(false);
    }
  };

  const forgot = async () => {
    if (!onForgotPassword) return;
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setError(null);
    try {
      await onForgotPassword(email.trim());
      setResetSent(true);
    } catch (exc: unknown) {
      setError(exc instanceof Error ? exc.message : "Envoi impossible.");
    }
  };

  const inputCls = (extra = "") =>
    cn(
      "w-full rounded-[14px] bg-panel px-3.5 py-2.5 text-[13.5px] text-ink outline-none transition-colors duration-150 ease-out",
      "hover:bg-[#292929] focus:bg-[#292929] focus:ring-2 focus:ring-accent/40 focus:border-accent",
      "border border-transparent focus:border-[#3B82F6] placeholder:text-ink-3/80",
      extra,
    );

  return (
    <div className="flex h-screen w-screen select-none flex-col items-center justify-center bg-bg font-sans text-ink">
      <form
        onSubmit={submit}
        className="flex w-[340px] max-w-[90vw] flex-col items-center"
        data-attr="login-form"
      >
        {/* Logo */}
        <img
          src="/logo_dark_transparent.png"
          alt="AImaging"
          data-attr="login-logo"
          className="app-logo h-min w-min animate-fade z-10"
          style={{ animationDelay: "0ms" }}
        />
        <p
          className="mt-4 text-[13px] text-ink-3 animate-fade"
          style={{ animationDelay: "180ms" }}
        >
          Analyse intelligente d&apos;images médicales
        </p>

        <div className="mt-10 w-full space-y-3 animate-fade" style={{ animationDelay: "260ms" }}>
          <div>
            <label className="mb-1.5 block text-[12px] text-ink-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@hospital.org"
              autoComplete="username"
              spellCheck={false}
              data-attr="login-email"
              className={inputCls()}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] text-ink-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              data-attr="login-password"
              className={inputCls()}
            />
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                data-attr="login-remember"
                className="h-3.5 w-3.5 cursor-pointer rounded accent-[#3B82F6]"
              />
              Remember me
            </label>
            <button
              type="button"
              onClick={forgot}
              data-attr="login-forgot"
              className="text-[12px] text-[#3B82F6] transition-colors duration-150 hover:text-[#4f8ef7] hover:underline"
            >
              Forgot password ?
            </button>
          </div>

          {error && (
            <p className="text-[12px] text-red-400" data-attr="login-error">
              {error}
            </p>
          )}
          {resetSent && (
            <p className="text-[12px] text-emerald-400" data-attr="login-forgot-msg">
              Reset link sent to {email}.
            </p>
          )}
        </div>

        <div
          className="mt-6 w-full animate-fade"
          style={{ animationDelay: "380ms" }}
        >
          <button
            type="submit"
            disabled={pending}
            data-attr="login-submit"
            className="w-full rounded-[14px] bg-[#3B82F6] py-2.5 text-[13.5px] font-medium text-white transition-all duration-150 ease-out hover:bg-[#4f8ef7] active:bg-[#2563eb] hover:shadow-lg hover:shadow-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>

      <p className="absolute bottom-6 text-[11px] text-ink-3/60 animate-fade" style={{ animationDelay: "500ms" }}>
        Version 1.0
      </p>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiPost } from "../api/client";
import { configKey } from "../hooks/useConfig";
import { sessionKey } from "../hooks/useSession";
import { Button } from "./Button";
import { Card } from "./Card";
import { Wordmark } from "./Logo";
import { TextField } from "./Select";

export function LoginScreen() {
  const queryClient = useQueryClient();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!passphrase || pending) return;
    setError(null);
    setLocked(false);
    setPending(true);
    try {
      await apiPost("/login", { passphrase });
      setPassphrase("");
      // The config gains businesses and accounts once signed in; fetch it before the shell opens.
      await queryClient.invalidateQueries({ queryKey: configKey });
      await queryClient.invalidateQueries({ queryKey: sessionKey });
    } catch (err) {
      const lockedOut = err instanceof ApiError && err.status === 429;
      setLocked(lockedOut);
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login">
      <div className="login__panel">
        <div className="login__brand">
          <Wordmark />
        </div>
        <Card>
          <h1 className="login__title">Sign in</h1>
          <p className="login__lede">This connection is over the tailnet. The passphrase stays on this machine.</p>
          <form className="login__form" onSubmit={onSubmit}>
            <TextField
              label="Passphrase"
              type="password"
              name="passphrase"
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              error={locked ? null : error}
              required
            />
            {locked && error ? (
              <p className="login__lockout" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="primary" loading={pending} disabled={passphrase.length === 0}>
              Sign in
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}

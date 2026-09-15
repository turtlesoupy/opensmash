import { useEffect, useState } from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  OAuthProvider,
  browserSessionPersistence,
  getAuth,
  getRedirectResult,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import FlameAction from "./FlameAction.jsx";

const EMAIL_KEY = "opensmash-sign-in-email";

async function readResult(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Could not sign in.");
  return result;
}

function firebaseAuth(config) {
  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}

function oauthProvider(providerName) {
  if (providerName === "google") return new GoogleAuthProvider();
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  return provider;
}

// Popups are the fast path on desktop. On iOS a popup is a full tab that Apple's
// form post leaves stranded on a blank handler page, and in a home-screen app it
// opens in Safari and never comes back. Those get the redirect flow instead,
// which only works because the auth domain is our own origin (see server/auth.js).
function prefersRedirect() {
  const ua = navigator.userAgent || "";
  const iOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true
    || window.matchMedia?.("(display-mode: standalone)").matches;
  return iOS || standalone;
}

function popupFailed(error) {
  return ["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request",
    "auth/operation-not-supported-in-this-environment", "auth/web-storage-unsupported"]
    .includes(error?.code);
}

function friendlyAuthError(error, fallback) {
  const code = error?.code || "";
  if (code === "auth/popup-blocked") return "Your browser blocked the sign-in window. Allow pop-ups for this site or try again.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "The sign-in window was closed before finishing.";
  if (code === "auth/network-request-failed") return "Could not reach the sign-in service. Check your connection and try again.";
  if (code === "auth/unauthorized-domain") return "Sign-in is not configured for this address yet.";
  if (code.startsWith("auth/")) return `Could not sign in (${code.slice(5).replace(/-/g, " ")}).`;
  return error?.message || fallback;
}

export default function AuthGate({
  accountOnly = false,
  cancelButtonRef,
  cancelLabel = "Cancel",
  onAuthenticated,
  onCancel,
}) {
  const [config, setConfig] = useState(null);
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_KEY) || "");
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function exchangeSession(auth, credential) {
    const idToken = await credential.user.getIdToken(true);
    const result = await readResult(await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }));
    await signOut(auth);
    localStorage.removeItem(EMAIL_KEY);
    onAuthenticated(result.user);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/config", { cache: "no-store" })
      .then(readResult)
      .then(async (loaded) => {
        if (cancelled) return;
        setConfig(loaded);
        if (!loaded.enabled) {
          if (accountOnly) {
            setStatus("unavailable");
            return;
          }
          const session = await readResult(await fetch("/api/session", { cache: "no-store" }));
          if (!cancelled) {
            onAuthenticated(session.user || {
              uid: "local-development",
              displayName: "Local developer",
              email: null,
              provider: "local",
            });
          }
          return;
        }
        const auth = firebaseAuth(loaded.firebase);
        // Session persistence: the redirect flow has to survive one navigation.
        // exchangeSession signs the SDK user out again right after the cookie
        // is minted, so nothing lingers past that.
        await setPersistence(auth, browserSessionPersistence);
        let redirected = null;
        try {
          redirected = await getRedirectResult(auth);
        } catch (redirectError) {
          if (!cancelled) setError(friendlyAuthError(redirectError, "Could not sign in."));
        }
        if (redirected?.user) {
          setStatus("signing-in");
          await exchangeSession(auth, redirected);
          return;
        }
        if (isSignInWithEmailLink(auth, window.location.href)) {
          const savedEmail = localStorage.getItem(EMAIL_KEY);
          if (savedEmail) {
            setStatus("signing-in");
            await exchangeSession(auth, await signInWithEmailLink(auth, savedEmail, window.location.href));
            window.history.replaceState({}, "", "/create");
            return;
          }
          setMessage("Enter the same email address to finish signing in.");
        }
        setStatus("idle");
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError.message);
          setStatus("idle");
        }
      });
    return () => { cancelled = true; };
  }, [accountOnly]);

  async function providerSignIn(providerName) {
    setStatus("signing-in");
    setError("");
    const auth = firebaseAuth(config.firebase);
    const provider = oauthProvider(providerName);
    try {
      // Isolated pages sever cross-origin popup references. The existing
      // redirect flow preserves sign-in without depending on window.opener.
      if (window.crossOriginIsolated || prefersRedirect()) {
        await signInWithRedirect(auth, provider);
        return; // the page navigates away; getRedirectResult picks it up on return
      }
      await exchangeSession(auth, await signInWithPopup(auth, provider));
    } catch (signInError) {
      if (popupFailed(signInError)) {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError) {
          setError(friendlyAuthError(redirectError, "Could not sign in."));
          setStatus("idle");
          return;
        }
      }
      setError(friendlyAuthError(signInError, "Could not sign in."));
      setStatus("idle");
    }
  }

  async function emailSignIn(event) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return;
    setStatus("signing-in");
    setError("");
    try {
      const auth = firebaseAuth(config.firebase);
      if (isSignInWithEmailLink(auth, window.location.href)) {
        await exchangeSession(auth, await signInWithEmailLink(auth, normalizedEmail, window.location.href));
        window.history.replaceState({}, "", "/create");
        return;
      }
      localStorage.setItem(EMAIL_KEY, normalizedEmail);
      await sendSignInLinkToEmail(auth, normalizedEmail, {
        url: `${window.location.origin}/create`,
        handleCodeInApp: true,
      });
      setMessage("Check your inbox for a sign-in link.");
      setStatus("sent");
    } catch (signInError) {
      setError(friendlyAuthError(signInError, "Could not send the sign-in link."));
      setStatus("idle");
    }
  }

  const providers = new Set(config?.enabled ? config.providers : []);
  const hasSocialProvider = providers.has("google") || providers.has("apple");
  const busy = status === "loading" || status === "signing-in";

  return (
    <section className="auth-gate" aria-labelledby="auth-title">
      <header className="creator-intro auth-heading">
        {!accountOnly && <p className="eyebrow">Uploader account</p>}
        <h2 id="auth-title">{accountOnly ? "Log In" : "Sign in to Create"}</h2>
        <p>{accountOnly
          ? "Log in to save the fighters you've created"
          : "Sign-in keeps fighter uploads accountable and lets you return to private builds. Playing and browsing public fighters stay open to everyone."}
        </p>
      </header>

      <div className="auth-options" aria-busy={busy}>
        {providers.has("google") && (
          <button
            className="launch-flow-action auth-provider-button"
            type="button"
            disabled={status !== "idle"}
            onClick={() => providerSignIn("google")}
          >
            Continue with Google
          </button>
        )}
        {providers.has("apple") && (
          <button
            className="launch-flow-action auth-provider-button"
            type="button"
            disabled={status !== "idle"}
            onClick={() => providerSignIn("apple")}
          >
            Continue with Apple
          </button>
        )}
        {providers.has("email") && (
          <form onSubmit={emailSignIn}>
            {hasSocialProvider && <p className="auth-divider">Or continue with email</p>}
            <div className="fighter-fields auth-email-field">
              <label htmlFor="sign-in-email">
                <span>Email address</span>
                <input
                  id="sign-in-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  disabled={busy}
                />
              </label>
            </div>
            <FlameAction
              cellClassName="auth-email-action"
              className="auth-email-button"
              type="submit"
              disabled={!email.trim() || busy}
            >
              Email a link
            </FlameAction>
          </form>
        )}
        {status === "loading" && <p className="auth-message" role="status">Loading sign-in…</p>}
        {status === "signing-in" && <p className="auth-message" role="status">Signing you in…</p>}
        {status === "unavailable" && (
          <p className="auth-message auth-unavailable" role="status">
            Account login is disabled for this local server. Restart it with{" "}
            <code>FIREBASE_AUTH_ENABLED=1</code> and the Firebase web app settings from{" "}
            <code>.env.example</code> to test a real sign-in.
          </p>
        )}
        {message && <p className="auth-message" role="status">{message}</p>}
        {error && <p className="creator-error" role="alert">{error}</p>}
        {onCancel && (
          <button
            ref={cancelButtonRef}
            className="launch-flow-action auth-cancel-button"
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        )}
      </div>
    </section>
  );
}

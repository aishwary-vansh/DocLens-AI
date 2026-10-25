/**
 * useGoogleSignIn
 * Loads Google Identity Services once, asks the backend for the public OAuth
 * client id (GET /auth/config) and renders the official "Sign in with Google"
 * button into `buttonRef`. Google returns an ID token ("credential"), which the
 * caller exchanges for a DocLens session (POST /auth/google).
 *
 * When the server has the redirect flow configured (client secret + callback
 * URL, GET /auth/config → googleRedirect), Google's script is not loaded at all:
 * the caller shows its own button that navigates to authApi.googleStartUrl().
 *
 * status: "loading" | "ready" | "redirect" | "unconfigured" | "error"
 */
import { useEffect, useRef, useState } from "react";
import { authApi } from "../services/api";

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisPromise = null;

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.google);
      script.onerror = () => {
        gisPromise = null;
        reject(new Error("Google sign-in could not load. Check your connection or ad blocker."));
      };
      document.head.appendChild(script);
    });
  }
  return gisPromise;
}

export default function useGoogleSignIn(onCredential, { text = "continue_with" } = {}) {
  const buttonRef = useRef(null);
  const callbackRef = useRef(onCredential);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { googleClientId, googleRedirect } = await authApi.config();
        if (cancelled) return;
        if (!googleClientId) {
          setStatus("unconfigured");
          return;
        }
        if (googleRedirect) {
          setStatus("redirect");
          return;
        }
        const google = await loadGis();
        if (cancelled || !buttonRef.current) return;
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => callbackRef.current?.(response.credential),
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        const width = Math.min(400, Math.max(220, Math.round(buttonRef.current.getBoundingClientRect().width)));
        google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text,
          logo_alignment: "left",
          width,
        });
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage(err?.message || "Google sign-in is unavailable right now.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text]);

  return { buttonRef, status, message };
}

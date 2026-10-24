/**
 * useServiceHealth
 * Polls the backend GET /health (API + AI service status)
 * every 30 seconds to provide real live status for the sidebar signal panel.
 */
import { useState, useEffect, useRef } from "react";

const BACKEND_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

const POLL_INTERVAL = 30_000; // 30 seconds
const TIMEOUT_MS    = 8_000;  // backend waits up to 5 s for the AI service

/** GET /health on the backend: { api: { ok }, ai: { ok, modelsLoaded } }.
 *  The AI service is internal-only, so the browser asks the backend about it. */
async function fetchHealth() {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: controller.signal });
    if (!res.ok) return { api: false, pipeline: false };
    const json = await res.json();
    const body = json?.data ?? json;
    return { api: true, pipeline: Boolean(body?.ai?.ok) };
  } catch {
    return { api: false, pipeline: false };
  } finally {
    clearTimeout(id);
  }
}

export default function useServiceHealth() {
  const [apiOk,      setApiOk]      = useState(null); // null = checking
  const [pipelineOk, setPipelineOk] = useState(null);
  const timer = useRef(null);

  const check = async () => {
    const { api, pipeline } = await fetchHealth();
    setApiOk(api);
    setPipelineOk(pipeline);
  };

  useEffect(() => {
    check(); // immediate check on mount
    timer.current = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(timer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { apiOk, pipelineOk };
}

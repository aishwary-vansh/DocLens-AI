/**
 * useServiceHealth
 * Polls the NestJS backend root endpoint and the FastAPI /health endpoint
 * every 30 seconds to provide real live status for the sidebar signal panel.
 */
import { useState, useEffect, useRef } from "react";

const BACKEND_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

const AI_URL = import.meta.env.VITE_AI_URL ?? "http://localhost:8000";

const POLL_INTERVAL = 30_000; // 30 seconds
const TIMEOUT_MS    = 5_000;  // 5 second timeout per request

async function fetchWithTimeout(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res.ok;
  } catch {
    clearTimeout(id);
    return false;
  }
}

export default function useServiceHealth() {
  const [apiOk,      setApiOk]      = useState(null); // null = checking
  const [pipelineOk, setPipelineOk] = useState(null);
  const timer = useRef(null);

  const check = async () => {
    const [api, pipeline] = await Promise.all([
      fetchWithTimeout(`${BACKEND_URL}/`),
      fetchWithTimeout(`${AI_URL}/health`),
    ]);
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

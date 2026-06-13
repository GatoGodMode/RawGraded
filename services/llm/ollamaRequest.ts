/** Per-request timeout for Ollama vision/chat calls (aligns with Gemini Phase 2 cap). */
export const OLLAMA_REQUEST_TIMEOUT_MS = 180_000;

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string' && reason) return new Error(reason);
  return new Error('Request cancelled');
}

/**
 * Fetch with combined external AbortSignal and wall-clock timeout.
 */
export async function ollamaFetch(
  url: string,
  init: RequestInit,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new Error(`Ollama request timed out after ${Math.round(timeoutMs / 1000)}s`));
  }, timeoutMs);

  const external = options?.signal;
  const onExternalAbort = () => timeoutController.abort(abortError(external?.reason));
  if (external) {
    if (external.aborted) {
      clearTimeout(timeoutId);
      throw abortError(external.reason);
    }
    external.addEventListener('abort', onExternalAbort);
  }

  try {
    return await fetch(url, { ...init, signal: timeoutController.signal });
  } catch (err) {
    if (timeoutController.signal.aborted) {
      throw abortError(timeoutController.signal.reason ?? err);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (external) external.removeEventListener('abort', onExternalAbort);
  }
}

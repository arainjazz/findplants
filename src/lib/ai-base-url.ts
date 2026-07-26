/**
 * Canonicalize an OpenAI-compatible API base. We always append the path ourselves
 * ("/chat/completions" to call, "/models" to list), so a base that already ends in
 * a route must be trimmed back — otherwise 「拉取可用模型」 asks the provider for
 * `/v1/chat/completions/models` and gets a 404. Users copy the full endpoint URL
 * out of vendor docs (Moonshot/Kimi, DeepSeek…) far more often than the bare /v1.
 */
export function normalizeBaseUrl(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(chat\/completions|completions|responses|messages)$/i, "")
    .replace(/\/+$/, "");
}

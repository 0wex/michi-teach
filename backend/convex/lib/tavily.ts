/**
 * Cliente ligero para la API de Tavily.
 *
 * Endpoints usados:
 *  - POST https://api.tavily.com/search  → descubrimiento de URLs relevantes.
 *  - POST https://api.tavily.com/extract → extracción de contenido limpio (markdown/text).
 *
 * Requiere `TAVILY_API_KEY` en el entorno de Convex.
 * Manejo defensivo de errores: timeouts por AbortController, respuestas no-2xx capturadas.
 */

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const DEFAULT_TIMEOUT_MS = 25_000;

export interface TavilySearchOptions {
  query: string;
  includeDomains?: string[];
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  includeAnswer?: boolean;
  timeoutMs?: number;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
}

export interface TavilySearchResponse {
  results: TavilySearchResult[];
  answer?: string;
}

export interface TavilyExtractOptions {
  urls: string[];
  extractDepth?: "basic" | "advanced";
  timeoutMs?: number;
}

export interface TavilyExtractResult {
  url: string;
  rawContent: string;
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failedResults: Array<{ url: string; error: string }>;
}

function requireApiKey(): string {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Falta TAVILY_API_KEY en las variables de entorno de Convex. " +
        "Configúrala con `npx convex env set TAVILY_API_KEY tvly-...`"
    );
  }
  return apiKey.trim();
}

async function tavilyFetch<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const apiKey = requireApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily (${res.status}) ${res.statusText}: ${text.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Tavily request timeout tras ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Busca URLs relevantes. Si `includeDomains` está presente, restringe la
 * búsqueda a esos dominios (ingesta autoritativa). Si se omite, funciona como
 * búsqueda web abierta (fallback en `hybridSearch`).
 */
export async function tavilySearch(opts: TavilySearchOptions): Promise<TavilySearchResponse> {
  const body: Record<string, unknown> = {
    query: opts.query,
    max_results: opts.maxResults ?? 5,
    search_depth: opts.searchDepth ?? "basic",
    include_answer: opts.includeAnswer ?? false,
  };
  if (opts.includeDomains && opts.includeDomains.length > 0) {
    body.include_domains = opts.includeDomains;
  }
  const raw = await tavilyFetch<{
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      score?: number;
      published_date?: string;
    }>;
    answer?: string;
  }>(TAVILY_SEARCH_URL, body, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const results: TavilySearchResult[] = (raw.results ?? [])
    .filter((r) => typeof r.url === "string" && typeof r.title === "string")
    .map((r) => ({
      title: r.title as string,
      url: r.url as string,
      content: r.content ?? "",
      score: typeof r.score === "number" ? r.score : undefined,
      publishedDate: r.published_date,
    }));

  return { results, answer: raw.answer };
}

/**
 * Extrae contenido limpio de una lista de URLs. Tavily admite hasta 20 URLs
 * por request; los llamadores deberían agrupar en tandas si superan ese límite.
 */
export async function tavilyExtract(opts: TavilyExtractOptions): Promise<TavilyExtractResponse> {
  if (!opts.urls || opts.urls.length === 0) {
    return { results: [], failedResults: [] };
  }
  const body = {
    urls: opts.urls,
    extract_depth: opts.extractDepth ?? "advanced",
  };
  const raw = await tavilyFetch<{
    results?: Array<{ url?: string; raw_content?: string }>;
    failed_results?: Array<{ url?: string; error?: string }>;
  }>(TAVILY_EXTRACT_URL, body, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const results: TavilyExtractResult[] = (raw.results ?? [])
    .filter((r) => typeof r.url === "string" && typeof r.raw_content === "string")
    .map((r) => ({ url: r.url as string, rawContent: r.raw_content as string }));

  const failedResults = (raw.failed_results ?? []).map((r) => ({
    url: r.url ?? "",
    error: r.error ?? "unknown",
  }));

  return { results, failedResults };
}

/** Clasifica un dominio en "official-docs" / "official-forum" para trazabilidad. */
export function classifyOfficialSource(url: string): "official-docs" | "official-forum" {
  const lower = url.toLowerCase();
  if (
    lower.includes("forum") ||
    lower.includes("community") ||
    lower.includes("discussions") ||
    lower.includes("stackexchange")
  ) {
    return "official-forum";
  }
  return "official-docs";
}

/**
 * Chunking utilities para la ingesta RAG.
 *
 * Estrategia:
 *  - Split por párrafos (dobles saltos de línea). Preserva la unidad semántica.
 *  - Tamaño objetivo ~800 tokens (~2400 caracteres) por chunk.
 *  - Overlap ~150 tokens (~450 caracteres) entre chunks contiguos para preservar contexto.
 *  - Si un solo párrafo excede el tamaño máximo se corta en subpárrafos por oración.
 *
 * También expone heurísticas para detectar "accepted answer" / "marked as solution"
 * y votos numéricos en snippets de foros oficiales.
 */

export const CHUNK_TARGET_CHARS = 2400; // ~800 tokens (aprox 3 chars/token)
export const CHUNK_OVERLAP_CHARS = 450; // ~150 tokens
export const CHUNK_MAX_CHARS = 2800; // margen antes de partir agresivamente

export interface Chunk {
  content: string;
  index: number;
  total: number;
}

/**
 * Corta un texto largo en chunks superpuestos respetando párrafos.
 * Devuelve al menos un chunk (aunque sea trivial) si `text` no está vacío.
 */
export function splitIntoChunks(text: string, options?: {
  targetChars?: number;
  overlapChars?: number;
  maxChars?: number;
}): Chunk[] {
  const target = options?.targetChars ?? CHUNK_TARGET_CHARS;
  const overlap = options?.overlapChars ?? CHUNK_OVERLAP_CHARS;
  const maxChars = options?.maxChars ?? CHUNK_MAX_CHARS;

  const clean = normalizeText(text);
  if (!clean) return [];

  const paragraphs = clean
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      pieces.push(p);
      continue;
    }
    for (const s of splitLongParagraph(p, maxChars)) {
      pieces.push(s);
    }
  }

  const chunks: string[] = [];
  let buffer = "";
  for (const piece of pieces) {
    if (!buffer) {
      buffer = piece;
      continue;
    }
    if (buffer.length + 2 + piece.length <= target) {
      buffer = `${buffer}\n\n${piece}`;
      continue;
    }
    chunks.push(buffer);
    const tail = buffer.length > overlap ? buffer.slice(buffer.length - overlap) : buffer;
    buffer = `${tail}\n\n${piece}`;
  }
  if (buffer) chunks.push(buffer);

  return chunks.map((content, index) => ({
    content,
    index,
    total: chunks.length,
  }));
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ0-9])/g);
  const out: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    if (!buffer) {
      buffer = sentence;
      continue;
    }
    if (buffer.length + 1 + sentence.length <= maxChars) {
      buffer = `${buffer} ${sentence}`;
    } else {
      out.push(buffer);
      buffer = sentence;
    }
  }
  if (buffer) out.push(buffer);
  return out.length > 0 ? out : [paragraph.slice(0, maxChars)];
}

/** Hash SHA-256 hex sobre un string. Se usa para dedup de chunks. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export interface QualitySignals {
  acceptedAnswer?: boolean;
  voteScore?: number;
  tavilyScore?: number;
}

/**
 * Heurística ligera para foros oficiales: busca marcadores textuales
 * ("accepted answer", "marked as solution", "solved", etc.) y patrones
 * numéricos tipo "12 votes" / "score 5". No es autoritativa, solo un boost.
 */
export function extractQualitySignals(
  content: string,
  extra?: { tavilyScore?: number }
): QualitySignals {
  const lower = content.toLowerCase();
  const acceptedAnswer =
    /accepted\s+answer/.test(lower) ||
    /marked\s+as\s+solution/.test(lower) ||
    /correct\s+answer/.test(lower) ||
    /respuesta\s+aceptada/.test(lower) ||
    /marcada?\s+como\s+soluci[oó]n/.test(lower);

  let voteScore: number | undefined;
  const voteMatch =
    /\b([+-]?\d{1,4})\s+(?:votes?|upvotes?|likes?|kudos)/i.exec(content) ||
    /score[:\s]+([+-]?\d{1,4})/i.exec(content) ||
    /reputation[:\s]+([+-]?\d{1,4})/i.exec(content);
  if (voteMatch) {
    const parsed = Number.parseInt(voteMatch[1], 10);
    if (!Number.isNaN(parsed)) voteScore = parsed;
  }

  const signals: QualitySignals = {};
  if (acceptedAnswer) signals.acceptedAnswer = true;
  if (voteScore !== undefined) signals.voteScore = voteScore;
  if (extra?.tavilyScore !== undefined) signals.tavilyScore = extra.tavilyScore;
  return signals;
}

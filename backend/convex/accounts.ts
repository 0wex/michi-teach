import { mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";

// Autenticación propia de la app de escritorio.
// Convex Auth (@convex-dev/auth) queda para los endpoints REST /api/auth/*;
// aquí exponemos mutations simples que el cliente vanilla puede llamar por WebSocket.

const PBKDF2_ITERATIONS = 100_000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derivePasswordHash(password: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return toHex(new Uint8Array(bits));
}

// Comparación en tiempo constante para no filtrar información por timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const register = mutation({
  args: { name: v.string(), email: v.string(), password: v.string() },
  handler: async (ctx, { name, email, password }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    if (!EMAIL_RE.test(normalizedEmail)) {
      throw new ConvexError("Ingresa un correo electrónico válido.");
    }
    if (password.length < 6) {
      throw new ConvexError("La contraseña debe tener al menos 6 caracteres.");
    }

    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();
    if (existing) {
      throw new ConvexError("Ya existe una cuenta registrada con ese correo.");
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await derivePasswordHash(password, salt);

    const accountId = await ctx.db.insert("accounts", {
      name: cleanName || normalizedEmail,
      email: normalizedEmail,
      passwordHash,
      salt: toHex(salt),
      createdAt: Date.now(),
    });

    return { accountId, email: normalizedEmail, name: cleanName || normalizedEmail };
  },
});

export const login = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    const normalizedEmail = email.trim().toLowerCase();

    const account = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();
    if (!account) {
      throw new ConvexError("No encontramos ninguna cuenta con ese correo.");
    }

    const candidate = await derivePasswordHash(password, fromHex(account.salt));
    if (!timingSafeEqual(candidate, account.passwordHash)) {
      throw new ConvexError("La contraseña no es correcta.");
    }

    return { accountId: account._id, email: account.email, name: account.name };
  },
});

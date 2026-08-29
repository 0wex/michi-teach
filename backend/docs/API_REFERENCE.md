# Especificación de API — Michi Teach Backend

Guía de consumo que complementa el contrato formal [`openapi.yaml`](./api/openapi.yaml).

---

## 1. Servidor en Producción / Dev

| Servicio | URL Base | Propósito |
| :--- | :--- | :--- |
| **Convex Cloud REST API** | `https://accurate-bloodhound-858.convex.site` | Endpoints HTTP REST |
| **Convex WebSocket SDK** | `https://accurate-bloodhound-858.convex.cloud` | Cliente reactivo (Tauri / Vite) |

---

## 2. Autenticación

Todos los endpoints de datos (`/api/conversations`, `/api/chat`, `/api/analyze`) **requieren** cabecera:

```
Authorization: Bearer <JWT>
```

Obtén el JWT vía Convex Auth:

- **WebSocket (app desktop):** `auth.signIn` con `provider: "password"` y `params: { email, password, flow: "signIn"|"signUp", name? }`
- **REST:** rutas `/api/auth/*` registradas por `auth.addHttpRoutes`

Proveedores implementados: `password`, `anonymous`. OAuth (GitHub/Google) **no** está configurado.

---

## 3. Endpoints protegidos

### `POST /api/chat` — requiere JWT

### `POST /api/analyze` — requiere JWT

### `GET /api/conversations` — requiere JWT, devuelve solo conversaciones del usuario autenticado

### `POST /api/conversations` — requiere JWT

**Errores comunes:**

| Código | Significado |
|--------|-------------|
| `401` | Sin JWT o token inválido |
| `403` | JWT válido pero conversación de otro usuario |
| `404` | Conversación no encontrada |
| `502` | OpenAI falló (con `OPENAI_API_KEY` configurada) |

---

## 4. Endpoint público

### `GET /api/health`

No requiere autenticación. Indica que el deployment responde; **no** garantiza que `OPENAI_API_KEY` esté configurada.

---

## 5. RAG (semilla de documentación)

`rag.seedDocs` es una **internalAction**. Ejecútala una vez desde el dashboard de Convex (Functions → Run) para poblar la base vectorial. Es idempotente: documentos existentes se omiten.

Variables requeridas en el dashboard Convex:

- `OPENAI_API_KEY` — chat, visión y embeddings
- `CONVEX_SITE_URL` — validación JWT (auth.config.ts)
- `OPENAI_MODEL` — opcional, default `gpt-4o-mini`

---

## 6. SDK WebSocket (cliente desktop)

El frontend usa el SDK directamente (no REST). Las mismas reglas de auth aplican:

- `conversations.list/create/remove` → requieren sesión
- `messages.list/sendAndReply` → requieren sesión + ownership de conversación
- `messages.save` → internal, no invocable desde cliente

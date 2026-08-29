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

Ejecuta una vez desde `backend/` para poblar la base vectorial (idempotente: omite documentos existentes):

```bash
cd backend
npm run seed
# equivalente: npx convex run rag:seedDocs "{}"
```

Estado actual en dev (`accurate-bloodhound-858`): **13 documentos** (davinci, blender, capcut, photoshop, premiere).

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

---

## 7. RAG & Progress (nuevo)

La ingesta RAG está impulsada por Tavily contra dominios oficiales listados en
`backend/convex/lib/appCatalog.ts`. La búsqueda es híbrida: primero vector local,
luego fallback web live si la cobertura es baja o si el usuario pide "verificar
con la web".



### Chat con captura (SDK / `/api/chat`)

El flujo con imagen **no requiere** que la app este en `APP_CATALOG`:

1. Identifica la herramienta visible en la captura (Vision, paso ligero).
2. Recupera contexto RAG filtrado si la herramienta esta catalogada.
3. Si **no** esta catalogada, usa Tavily live en ese momento (sin persistir chunks).
4. Genera respuesta final con coordenadas.

Los endpoints HTTP mantienen el mismo contrato; `detectedToolName` y `requireLive` son internos de `messages.sendAndReply`.

### Variables adicionales

- `TAVILY_API_KEY` — cliente de Tavily (`backend/convex/lib/tavily.ts`).
  Setear con `npx convex env set TAVILY_API_KEY tvly-...`.

### Cron

`internal.rag.ingestAllApps` corre cada 14 días (ver `backend/convex/crons.ts`)
recorriendo todas las apps del catálogo y refrescando la ingesta oficial.

### CLI manual

```bash
# Ingesta puntual de una app (usa los seedTopics del catálogo)
npx convex run rag:runIngestApp '{"app":"windows"}'

# Con topics custom
npx convex run rag:runIngestApp '{"app":"davinci","topics":["nodo paralelo"]}'

# Búsqueda híbrida
npx convex run rag:runHybridSearch '{"query":"como hago un keyframe","app":"davinci"}'
```

### `POST /api/rag/ingest` — requiere JWT

Body:

```json
{ "app": "windows", "topics": ["atajos de teclado en Windows 11"] }
```

- `app` (string, obligatorio) — key del catálogo (o alias resoluble).
- `topics` (string[], opcional) — si se omite, usa `seedTopics`.

Respuesta:

```json
{
  "success": true,
  "result": {
    "app": "windows",
    "runId": "kgabc...",
    "status": "success" | "partial" | "failed",
    "urlsDiscovered": 20,
    "chunksInserted": 34,
    "chunksSkipped": 12
  }
}
```

Auditoría en la tabla `ingestionRuns` (índice `by_app`, `by_startedAt`).

### `POST /api/rag/search` — requiere JWT

Body:

```json
{ "query": "como creo un keyframe", "app": "davinci", "forceWeb": false, "limit": 4 }
```

- `forceWeb: true` fuerza Tavily live sin dominios (equivalente a que el usuario
  diga "verifica con la web").
- Umbrales de baja cobertura: top-1 < `0.72` o menos de 2 hits con score > `0.6`.

Respuesta:

```json
{
  "success": true,
  "hits": [
    {
      "title": "...",
      "content": "...",
      "tool": "davinci",
      "score": 0.83,
      "url": "https://blackmagicdesign.com/...",
      "source": "official-docs",
      "topic": "..."
    }
  ]
}
```

### `GET /api/progress?app=<key>` — requiere JWT

- Sin query: devuelve todos los registros del usuario (`listAppsWithProgress`).
- Con `?app=<key>`: devuelve el registro para esa app o `null`.

### `POST /api/progress` — requiere JWT

Body para `upsert` (default cuando no hay `action`):

```json
{
  "app": "davinci",
  "currentTopic": "keyframes",
  "currentStepIndex": 2,
  "detectedLevel": "beginner"
}
```

Otras acciones vía campo `action`:

- `{"action":"completeTopic", "app":"davinci", "topic":"keyframes"}`
- `{"action":"addErrorNote", "app":"davinci", "note":"no encontró el rombo", "topic":"keyframes"}`

Todas las mutaciones se hacen contra el usuario autenticado (JWT obligatorio) y
persisten en `learningProgress`.

### Cambios en `POST /api/chat` y `POST /api/analyze`

- Nuevo campo opcional `app` (string) para forzar el filtro por herramienta al
  llamar a `rag.hybridSearch`.
- La respuesta del assistant ahora incluye `sources: [{title, url, source}]`
  con la trazabilidad de los fragmentos usados.
- El asistente responde `"No tengo información oficial verificada para esto"`
  cuando el contexto oficial no cubre la pregunta.
- Se detectan frases del usuario del tipo "verifica con la web / búscalo online /
  actualiza" para forzar el fallback Tavily live.

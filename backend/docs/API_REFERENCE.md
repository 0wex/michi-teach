# Especificación de API y Referencia de Integración — Vision Guide

Este documento es la guía de consumo que complementa el contrato formal [`openapi.yaml`](file:///C:/Users/mclev/Documents/GitHub/michi-teach/backend/docs/api/openapi.yaml) para Vision Guide. Define los endpoints HTTP REST expuestos en vivo por el backend de Convex.

---

## 1. Servidor en Producción / Dev

| Servicio | URL Base | Propósito |
| :--- | :--- | :--- |
| **Convex Cloud REST API** | `https://accurate-bloodhound-858.convex.site` | Endpoints HTTP REST (Health, Chat, Análisis, Conversaciones, Auth) |
| **Convex WebSocket SDK** | `https://accurate-bloodhound-858.convex.cloud` | Conexión reactiva en tiempo real para React / Next.js / Vite |

---

## 2. Endpoints de Asistencia Visual e IA (OpenAI GPT-4o Mini)

### `POST /api/chat`
Envía una consulta al chat con soporte para capturas de pantalla de **cualquier software**. Si se incluye una imagen, el modelo multimodal **OpenAI GPT-4o Mini** detecta el botón o herramienta y devuelve sus coordenadas normalizadas en pantalla (`x`, `y` entre 0.0 y 1.0).

**Request Body:**
```json
{
  "conversationId": "k179e8gnd3m3rr4r56rkjgg7058ddewt",
  "content": "¿Dónde está la herramienta de recorte?",
  "imageBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

**Respuesta Exitosa (`200 OK`):**
```json
{
  "success": true,
  "userMessageId": "k575rgkr9rqfes0m3bh5z28my98ddy7p",
  "assistantMessageId": "k57f77c22r3a1shp9ha009vp7h8dcw08",
  "content": "La herramienta de recorte está en la barra superior central.",
  "visualHighlight": {
    "label": "Herramienta de recorte",
    "x": 0.45,
    "y": 0.12
  }
}
```

---

### `POST /api/analyze`
Endpoint de inferencia visual directa para análisis rápido de una captura sin necesidad de crear un hilo de conversación previo.

**Request Body:**
```json
{
  "question": "¿Dónde está el botón principal?",
  "imageBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

**Respuesta Exitosa (`200 OK`):**
```json
{
  "success": true,
  "explanation": "El botón principal está en la parte central superior.",
  "visualHighlight": {
    "label": "Botón principal",
    "x": 0.5,
    "y": 0.6
  },
  "conversationId": "k1724xsqrfan5vq9xrcv4xh9558dc7gd"
}
```

---

## 3. Endpoints de Gestión de Conversaciones

### `GET /api/conversations`
Lista las conversaciones activas en orden cronológico descendente.

**Respuesta Exitosa (`200 OK`):**
```json
[
  {
    "_id": "k179e8gnd3m3rr4r56rkjgg7058ddewt",
    "title": "Sesión de Asistencia Visual",
    "createdAt": 1788021032824
  }
]
```

### `POST /api/conversations`
Crea un nuevo hilo de conversación.

**Request Body:**
```json
{
  "title": "Edición de Proyecto Alpha"
}
```

**Respuesta Exitosa (`201 Created`):**
```json
{
  "_id": "k179e8gnd3m3rr4r56rkjgg7058ddewt",
  "title": "Edición de Proyecto Alpha",
  "createdAt": 1788021032824
}
```

---

## 4. Endpoints de Salud y Autenticación

### `GET /api/health`
Verificación de latencia y estado del backend.
```json
{
  "status": "ok",
  "timestamp": 1788021457505,
  "version": "1.0.0",
  "service": "Vision Guide Convex Backend"
}
```

### `POST /api/auth/signin`
Manejado automáticamente por Convex Auth. Acepta flujos con contraseña (`flow: "signIn"` o `"signUp"`) y modo invitado (`provider: "anonymous"`), emitiendo tokens JWT en formato RS256.

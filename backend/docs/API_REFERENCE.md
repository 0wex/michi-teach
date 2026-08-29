# Especificación de API y Contratos — Vision Guide

Este documento complementa el contrato formal [`openapi.yaml`](file:///C:/Users/mclev/Documents/GitHub/michi-teach/docs/api/openapi.yaml) y define los endpoints HTTP expuestos por el backend de Convex y el agente Desktop para la hackathon.

---

## 1. Servidores Disponibles

| Entorno | URL Base | Propósito |
| :--- | :--- | :--- |
| **Convex Cloud Backend** | `https://{deploymentName}.convex.site` | Endpoints HTTP públicos (Análisis, Chat, Sesiones) |
| **Desktop Local Agent** | `http://localhost:3001` | Captura de pantalla de ventana activa (Tauri / runner local) |

---

## 2. Endpoints Principales

### `POST /api/analyze`
El endpoint central de inferencia visual. Recibe la captura del editor de video y devuelve las coordenadas exactas de la UI calculadas con Claude 3.7 Vision.

**Request Body:**
```json
{
  "imageBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "question": "¿Dónde agrego un keyframe en la línea de tiempo?",
  "tool": "davinci",
  "version": "21.0.4"
}
```

**Respuesta Exitosa (`200 OK`):**
```json
{
  "success": true,
  "coordinates": {
    "x": 0.452,
    "y": 0.781
  },
  "buttonName": "Botón de Diamante de Keyframe",
  "explanation": "Haz clic en el ícono del diamante en la barra superior para insertar un keyframe.",
  "executionTimeMs": 840,
  "requestId": "req_12345"
}
```

> [!NOTE]
> **Coordenadas Normalizadas:**  
> `x` (0.0 a 1.0) y `y` (0.0 a 1.0) representan la posición porcentual del centro del botón respecto al ancho y alto total de la imagen.  
> El frontend puede posicionar el overlay simplemente con:  
> `style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: 'translate(-50%, -50%)' }}`.

---

### `GET /api/conversations` y `POST /api/conversations`
Gestión de hilos de chat para cada usuario. Permite agrupar las consultas de una misma sesión de trabajo.

---

### `POST /api/conversations/{conversationId}/messages`
Envía un mensaje al hilo de chat. Puede incluir o no una captura de pantalla.
- Si incluye captura: el asistente responde con asistencia visual (`visualHighlight` con `{x, y}`).
- Si es una pregunta conceptual: el asistente responde con texto pedagógico contextualizado.

---

### `GET /api/health`
Verificación de latencia y estado del backend en la nube.
```json
{
  "status": "ok",
  "timestamp": 1724940000000,
  "version": "1.0.0"
}
```

---

## 3. Integración Directa desde el Frontend (Cliente React de Convex)

Para el equipo de Frontend (Next.js), además de los endpoints HTTP, Convex ofrece llamadas tipadas directas:
```typescript
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// 1. Obtener mensajes reactivos (se actualizan solos):
const messages = useQuery(api.messages.list, { conversationId });

// 2. Analizar captura y recibir respuesta de la IA:
const analyze = useAction(api.guide.analyzeScreenshot);
const result = await analyze({ imageBase64, question, tool: "davinci" });
```

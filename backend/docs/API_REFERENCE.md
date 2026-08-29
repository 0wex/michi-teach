# Especificación de API y Contratos — Vision Guide

Este documento complementa el contrato formal [`openapi.yaml`](file:///C:/Users/mclev/Documents/GitHub/michi-teach/backend/docs/api/openapi.yaml) y define los endpoints HTTP expuestos por el backend de Convex y el agente Desktop para la hackathon.

---

## 1. Servidores Disponibles

| Entorno | URL Base | Propósito |
| :--- | :--- | :--- |
| **Convex Cloud Backend** | `https://{deploymentName}.convex.site` | Endpoints HTTP públicos (Auth, Análisis, Chat, Sesiones) |
| **Desktop Local Agent** | `http://localhost:3001` | Captura de pantalla de ventana activa (Tauri / runner local) |

---

## 2. Endpoints de Autenticación (`/api/auth/*`)

La autenticación está impulsada por **Convex Auth (`@convex-dev/auth`)**, lo que permite autenticar sin servidores externos pesados:

### `POST /api/auth/signup`
Crea una nueva cuenta de usuario con email, contraseña y nombre.

**Request Body:**
```json
{
  "name": "Alejandro Editor",
  "email": "editor@visionguide.dev",
  "password": "secretPassword123",
  "preferredTool": "davinci"
}
```

**Respuesta Exitosa (`201 Created`):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsIn...",
  "user": {
    "id": "usr_987654",
    "name": "Alejandro Editor",
    "email": "editor@visionguide.dev",
    "isAnonymous": false
  }
}
```

### `POST /api/auth/signin`
Permite registrarse o iniciar sesión mediante contraseña, GitHub OAuth o modo anónimo (guest).

**Request Body (Email / Password):**
```json
{
  "provider": "password",
  "email": "editor@visionguide.dev",
  "password": "secretPassword123",
  "flow": "signIn"
}
```

**Request Body (Modo Invitado / Anonymous):**
```json
{
  "provider": "anonymous"
}
```

**Respuesta Exitosa (`200 OK`):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsIn...",
  "user": {
    "id": "usr_987654",
    "name": "Alejandro Editor",
    "email": "editor@visionguide.dev",
    "isAnonymous": false
  }
}
```

### `GET /api/auth/user`
Devuelve el perfil del usuario autenticado enviando el header `Authorization: Bearer <token>`.

### `POST /api/auth/signout`
Invalida la sesión actual en el backend.

---

## 3. Endpoints de Análisis y Visión

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

---

## 4. Endpoints de Chat y Conversaciones

### `GET /api/conversations` y `POST /api/conversations`
Gestión de hilos de chat para cada usuario. Permite agrupar las consultas de una misma sesión de trabajo.

### `POST /api/conversations/{conversationId}/messages`
Envía un mensaje al hilo de chat. Puede incluir o no una captura de pantalla.
- Si incluye captura: el asistente responde con asistencia visual (`visualHighlight` con `{x, y}`).
- Si es una pregunta conceptual: el asistente responde con texto pedagógico contextualizado.

### `GET /api/health`
Verificación de latencia y estado del backend en la nube.
```json
{
  "status": "ok",
  "timestamp": 1724940000000,
  "version": "1.0.0"
}
```

# PROYECTO: VISION GUIDE — Tutor de Software en Tiempo Real
**Versión del Documento:** 2.0 (Arquitectura Híbrida Nativa)  
**Fecha:** 29 de Agosto, 2026  
**Contexto:** Hackathon "The Next Craft" + Desarrollo de Producto.

---

## 1. Visión General (El "Elevator Pitch")
**Vision Guide** es un asistente contextual que convierte la pantalla del usuario en un lienzo interactivo. El usuario simplemente escribe "¿Cómo pongo un keyframe?" y el sistema **captura automáticamente su editor de video** (DaVinci Resolve o CapCut), **identifica la herramienta** que está usando, **señala con una animación el botón exacto** en la interfaz y **lee en voz alta** los pasos a seguir, todo sin necesidad de subir archivos manualmente ni buscar tutoriales obsoletos.

---

## 2. El Problema de Fondo
- **Obsolescencia de Contenido:** DaVinci Resolve y CapCut actualizan su UI cada 4-6 semanas. Un tutorial de YouTube de hace 3 meses ya no es fiable.
- **Fricción del Aprendizaje:** Los usuarios abandonan los tutoriales cuando el botón "no está donde debería". La documentación oficial es densa y nadie la lee en medio de una edición.
- **Brecha OS:** Herramientas como HeyClicky son exclusivas de macOS. Nuestra propuesta nace siendo **multiplataforma** (Windows, macOS, Linux) desde el día 1.

---

## 3. Stack Tecnológico Definitivo (2026)
*Este stack está elegido por equilibrio entre velocidad de desarrollo (hackathon) y rendimiento de producto (escalabilidad).*

| Capa | Tecnología | Justificación Estratégica |
| :--- | :--- | :--- |
| **Motor de UI** | **Next.js 16 (App Router) + React 19 + TS** | Interfaz rica, renderizado eficiente del overlay, y fácil integración con el backend. |
| **App Nativa (El "Ojo")** | **Tauri v2 + Rust** | Captura de pantalla nativa SIN el peso de Electron. Tamaño < 15MB, memoria baja, y acceso directo a APIs de ventanas (Win32, macOS, X11). |
| **Backend & Estado (Nube)** | **Convex** | Reemplaza Base de Datos, Servidor, y WebSockets. Sincroniza el estado en tiempo real entre la captura y el overlay. |
| **Almacenamiento** | **Convex File Storage** | Guarda el screenshot subido (o capturado) para mostrarlo en la UI y como evidencia. |
| **Modelo de Visión (IA)** | **Claude 3.5 Sonnet / 3.7** (API Anthropic) | Mejor relación calidad-precio para razonamiento espacial en UIs densas. Devuelve coordenadas exactas (X, Y) en JSON. |
| **Síntesis de Voz** | **Web Speech API (Browser)** | Sin dependencias de terceros. Lectura instantánea de la guía generada. |
| **Orquestación** | **Convex Actions** | Orquesta el flujo: Recibe imagen -> Inyecta documentación -> Llama a Claude -> Valida JSON -> Retorna a UI. |

---

## 4. Flujo de Trabajo Detallado (User & System Journey)

### Paso 0: Setup Inicial (Solo una vez)
- El usuario instala la **App Tauri** y la ejecuta en segundo plano.
- La app solicita permisos de accesibilidad/captura (solo la primera vez).
- La app inicia un servidor HTTP local en `http://localhost:3001` o un canal IPC para servir la captura.

### Paso 1: La Interacción Mágica
1. **Usuario:** Abre la Web (o la interfaz embebida) y escribe en el chat: *"¿Cómo añado un nodo de corrección de color?"*.
2. **Frontend (Next.js):** Pulsa el botón de "Ayuda".
3. **Frontend -> Tauri:** La web llama al endpoint local `GET /screenshot` (o mediante `invoke` de Tauri).
4. **Tauri (Rust):** Detecta la ventana activa (ej: "DaVinci Resolve 21.0.4"). Captura el buffer de píxeles de ESA ventana específica. Convierte a base64. Devuelve JSON: `{ "tool": "davinci", "image_base64": "..." }`.

### Paso 2: El "Cerebro" en la Nube
1. **Frontend -> Convex:** Envía la imagen, la pregunta, y el nombre de la herramienta detectada a una **Convex Action**.
2. **Convex Action (El Prompt):** Construye el prompt para Claude:
   - *Contexto:* "Eres un experto en DaVinci Resolve 21.0.4. Aquí tienes la interfaz actual del usuario."
   - *Evidencia:* (Imagen en base64).
   - *Instrucción:* "Señala las coordenadas X e Y (normalizadas 0-1) del elemento que resuelve la pregunta. Devuelve SOLO JSON: `{ "x": 0.45, "y": 0.78, "explanation": "Ve al panel Color y haz clic en..." }`".

### Paso 3: La Retroalimentación (Feedback Loop)
1. **Convex -> Frontend:** Retorna el JSON con las coordenadas y el texto.
2. **Frontend (Overlay):** Dibuja un círculo pulsante/anillo de enfoque sobre la imagen del screenshot exactamente en esas coordenadas (usando `position: absolute`).
3. **Frontend (Voz):** Usa `SpeechSynthesis` para leer la "explanation" en voz alta.

---

## 5. Contexto de IA y Prompt Engineering (El "Grounding")

La clave del producto no es solo "ver" la imagen, sino "saber" qué botón es. Para evitar alucinaciones, el prompt debe inyectar **documentación oficial curada**.

**Estructura del Prompt Final (en Convex Action):**

```text
ROL: Eres un tutor experto en {tool_name} versión {version}.
CONTEXTO VISUAL: Aquí tienes un screenshot de la interfaz actual del usuario.
DOCUMENTACIÓN OFICIAL (Contexto adicional):
{insertar fragmento de texto de la documentación oficial de esa versión específica, ej: "El panel de Keyframes está en la esquina inferior izquierda de la línea de tiempo..."}
PREGUNTA DEL USUARIO: {question}
TAREA:
1. Identifica el elemento exacto de la UI en la imagen que el usuario debe usar.
2. Devuelve las coordenadas X e Y normalizadas (0 a 1) donde el centro de ese elemento se encuentra en la imagen.
3. Redacta una guía de 1-2 pasos (máximo 30 palabras) explicando qué hacer.
FORMATO DE RESPUESTA (JSON ESTRICTO):
{"x": number, "y": number, "explanation": string}
```

*Nota para el MVP:* La documentación se inyecta como un string fijo en el código de la Action. Para el futuro, esto se reemplazará por un pipeline de RAG sobre índices de documentación oficial.

---

## 6. MVP vs. Roadmap (Alcance del Hackathon)

### ✅ DENTRO DEL ALCANCE (12 HORAS)
- Captura de pantalla manual (al hacer clic en "Ayuda") desde la app Tauri.
- Soporte para **UNA** herramienta (Decidir entre DaVinci Resolve o CapCut).
- Overlay animado (círculo/ripple) sobre la imagen estática.
- Lectura de voz con Web Speech API.
- End-to-end funcionando: Web -> Tauri -> Convex -> Claude -> Web.

### 🚫 FUERA DE ALCANCE (Post-Hackathon)
- Captura continua en tiempo real (streaming de pantalla).
- Automatización de clics (el asistente NO hace clic por el usuario, solo señala).
- Sistema de autenticación de usuarios o planes de pago.
- Pipeline de RAG automático (la docu es hardcodeada para el MVP).

---

## 7. Criterios de Aceptación (DoD - Definition of Done)

Para que la demo del hackathon sea un éxito, debe cumplir con:

1. **Cero Fricción:** El usuario NO debe tocar la app Tauri una vez instalada. Todo se controla desde la web.
2. **Identificación Contextual:** El sistema debe reconocer que está viendo DaVinci Resolve (por el título de ventana) y no preguntarle al usuario.
3. **Precisión del Overlay:** El círculo animado debe aparecer **sobre el botón correcto** en la imagen (ej. el botón de "Curve" o "Keyframe"). Tolerancia de desfase < 50 píxeles.
4. **Claridad de la Voz:** La explicación leída debe ser relevante y no genérica (ej. no decir "busca en el menú", sino "haz clic en el ícono del rombo en la barra superior").

---

## 8. Consideraciones Técnicas para el Equipo

- **Seguridad (CORS):** La app Tauri (localhost:3001) debe permitir CORS desde `http://localhost:3000` para desarrollo.
- **Manejo de Errores:** Si Claude no encuentra el elemento, debe devolver `null` y la UI mostrará "No encontré ese elemento, intenta ser más específico".
- **Rendimiento:** La captura con Rust (`xcap`) debe tomar menos de 50ms para no romper la fluidez de la demo.

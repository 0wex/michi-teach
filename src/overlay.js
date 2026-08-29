import './overlay.css';
import { listen } from '@tauri-apps/api/event';

// Port de `animateBezierFlightArc` de Clicky (OverlayWindow.swift:472-535).
// El backend de Michi devuelve `visualHighlight: { x, y, label }` con x/y
// normalizados 0..1 respecto a la captura. Esta ventana ocupa el área de
// trabajo del monitor principal a pantalla completa, así que basta multiplicar
// por su tamaño para pasar a píxeles.

const stage = document.querySelector('#stage');
const pointer = document.querySelector('#pointer');
const label = document.querySelector('#label');
const voice = document.querySelector('#voice');
const dbg = document.querySelector('#dbg');
const shapes = document.querySelector('#shapes');
const SVGNS = 'http://www.w3.org/2000/svg';

// HUD de diagnóstico. Se muestra si localStorage michi.overlayDebug === "1", y
// siempre durante los primeros 8 s tras cargar (para confirmar que la ventana
// overlay existe y recibe eventos).
let dbgLines = [];
let dbgForced = true;
setTimeout(() => {
  dbgForced = false;
  syncDbg();
}, 8000);

function dbgLog(line) {
  dbgLines.push(line);
  if (dbgLines.length > 8) dbgLines = dbgLines.slice(-8);
  syncDbg();
}

function syncDbg() {
  let on = dbgForced;
  try {
    on = on || localStorage.getItem('michi.overlayDebug') === '1';
  } catch {
    /* localStorage puede lanzar */
  }
  dbg.hidden = !on;
  if (on) dbg.textContent = dbgLines.join('\n');
}

dbgLog(`overlay listo · viewport ${window.innerWidth}×${window.innerHeight}`);

// Autoprueba: al arrancar dibuja una figura de cada tipo unos segundos, para
// confirmar que el overlay renderiza y está por encima de todo.
setTimeout(() => {
  drawAnnotations([
    { kind: 'rect', x: 0.34, y: 0.36, w: 0.32, h: 0.24, label: 'overlay OK', step: 1 },
    { kind: 'point', x: 0.5, y: 0.48, label: 'punto', step: 2 },
    { kind: 'arrow', x: 0.2, y: 0.2, x2: 0.34, y2: 0.36, label: 'flecha', step: 3 },
  ]);
}, 400);

const POINTER_HALF = 14; // el SVG mide 28px; su centro está a 14px
const EDGE_MARGIN = 20; // recorte a los bordes, igual que Clicky
const TARGET_OFFSET_X = 8; // el puntero se posa al lado del elemento, no encima
const TARGET_OFFSET_Y = 12;
const HOLD_MS = 2000; // cuánto se queda señalando antes de desvanecerse

let flightRaf = 0;
let hideTimer = 0;
// Última posición del puntero, para que el siguiente vuelo salga de ahí.
let lastPoint = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function placePointer(x, y, angleDeg, scale = 1) {
  pointer.style.transform =
    `translate(${x - POINTER_HALF}px, ${y - POINTER_HALF}px) rotate(${angleDeg}deg) scale(${scale})`;
}

function showLabel(text, x, y) {
  if (!text) {
    label.classList.remove('is-visible');
    return;
  }
  label.textContent = text;
  // Medir para no salirnos de la pantalla.
  label.style.transform = 'translateY(4px)';
  label.classList.add('is-visible');
  const rect = label.getBoundingClientRect();
  let lx = x + 18;
  let ly = y - rect.height / 2;
  if (lx + rect.width > window.innerWidth - EDGE_MARGIN) {
    lx = x - rect.width - 18;
  }
  ly = clamp(ly, EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN);
  label.style.left = `${lx}px`;
  label.style.top = `${ly}px`;
}

function flyTo(targetX, targetY, labelText) {
  cancelAnimationFrame(flightRaf);
  clearTimeout(hideTimer);

  const endX = clamp(targetX + TARGET_OFFSET_X, EDGE_MARGIN, window.innerWidth - EDGE_MARGIN);
  const endY = clamp(targetY + TARGET_OFFSET_Y, EDGE_MARGIN, window.innerHeight - EDGE_MARGIN);

  // Punto de partida: la última posición, o una esquina si es el primer vuelo.
  const start = lastPoint || { x: window.innerWidth - 80, y: window.innerHeight - 80 };
  const deltaX = endX - start.x;
  const deltaY = endY - start.y;
  const distance = Math.hypot(deltaX, deltaY);

  stage.classList.add('is-visible');
  label.classList.remove('is-visible');

  if (distance < 1) {
    placePointer(endX, endY, 0, 1);
    lastPoint = { x: endX, y: endY };
    showLabel(labelText, endX, endY);
    hideTimer = setTimeout(hideOverlay, HOLD_MS);
    return;
  }

  // Duración escalada por distancia, acotada a 0.6s–1.4s.
  const durationMs = clamp(distance / 800, 0.6, 1.4) * 1000;
  // Punto de control del bezier cuadrático: punto medio elevado.
  const arcHeight = Math.min(distance * 0.2, 80);
  const midX = (start.x + endX) / 2;
  const midY = (start.y + endY) / 2;
  const ctrlX = midX;
  const ctrlY = midY - arcHeight;

  const startTime = performance.now();

  function frame(now) {
    const linearT = clamp((now - startTime) / durationMs, 0, 1);
    // easeOut suave, como el `.easeOut` de SwiftUI.
    const t = 1 - Math.pow(1 - linearT, 3);
    const inv = 1 - t;

    // B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2
    const bx = inv * inv * start.x + 2 * inv * t * ctrlX + t * t * endX;
    const by = inv * inv * start.y + 2 * inv * t * ctrlY + t * t * endY;

    // B'(t) = 2(1-t)(P1-P0) + 2t(P2-P1)  → tangente para orientar el triángulo
    const tanX = 2 * inv * (ctrlX - start.x) + 2 * t * (endX - ctrlX);
    const tanY = 2 * inv * (ctrlY - start.y) + 2 * t * (endY - ctrlY);
    const angle = (Math.atan2(tanY, tanX) * 180) / Math.PI;

    // Crece un poco a mitad de vuelo y vuelve a 1 al aterrizar.
    const scale = 1 + 0.35 * Math.sin(Math.PI * linearT);

    placePointer(bx, by, angle, scale);

    if (linearT < 1) {
      flightRaf = requestAnimationFrame(frame);
    } else {
      lastPoint = { x: endX, y: endY };
      showLabel(labelText, endX, endY);
      hideTimer = setTimeout(hideOverlay, HOLD_MS);
    }
  }

  flightRaf = requestAnimationFrame(frame);
}

function hideOverlay() {
  cancelAnimationFrame(flightRaf);
  clearTimeout(hideTimer);
  drawTimers.forEach(clearTimeout);
  drawTimers = [];
  stage.classList.remove('is-visible');
  label.classList.remove('is-visible');
  clearShapes();
}

// ---------- Figuras: rectángulos, flechas y puntos numerados ----------

let drawTimers = [];

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function clearShapes() {
  // Conservar solo <defs>.
  [...shapes.children].forEach((c) => {
    if (c.tagName.toLowerCase() !== 'defs') c.remove();
  });
}

function stepBadge(cx, cy, step) {
  if (!Number.isFinite(step)) return null;
  const g = svgEl('g', { class: 'shape-in' });
  g.appendChild(svgEl('circle', { class: 'badge-bg', cx, cy, r: 12 }));
  const t = svgEl('text', { class: 'badge-text', x: cx, y: cy });
  t.textContent = String(step);
  g.appendChild(t);
  return g;
}

function shapeLabel(x, y, text) {
  if (!text) return null;
  const t = svgEl('text', { class: 'shape-label', x, y });
  t.textContent = text;
  return t;
}

// Dibuja una lista de anotaciones normalizadas 0..1, escalonadas en el tiempo.
function drawAnnotations(list) {
  cancelAnimationFrame(flightRaf);
  clearTimeout(hideTimer);
  drawTimers.forEach(clearTimeout);
  drawTimers = [];
  clearShapes();
  pointer.style.transform = 'translate(-100px,-100px)'; // esconde el triángulo
  label.classList.remove('is-visible');
  stage.classList.add('is-visible');

  const W = window.innerWidth;
  const H = window.innerHeight;

  list.forEach((a, i) => {
    const t = setTimeout(() => renderAnnotation(a, W, H), i * 180);
    drawTimers.push(t);
  });

  // Tiempo en pantalla: más pasos → más tiempo para leerlos.
  const hold = Math.min(3000 + list.length * 1800, 14000);
  hideTimer = setTimeout(hideOverlay, hold + list.length * 180);
}

function renderAnnotation(a, W, H) {
  if (a.kind === 'rect') {
    const x = a.x * W;
    const y = a.y * H;
    const w = Math.max(a.w * W, 8);
    const h = Math.max(a.h * H, 8);
    shapes.appendChild(
      svgEl('rect', { class: 'shape shape-rect shape-in', x, y, width: w, height: h })
    );
    const badge = stepBadge(x, y, a.step);
    if (badge) shapes.appendChild(badge);
    const lbl = shapeLabel(x + (Number.isFinite(a.step) ? 18 : 2), Math.max(y - 10, 14), a.label);
    if (lbl) shapes.appendChild(lbl);
    return;
  }

  if (a.kind === 'arrow') {
    const x1 = a.x * W;
    const y1 = a.y * H;
    const x2 = a.x2 * W;
    const y2 = a.y2 * H;
    shapes.appendChild(
      svgEl('line', { class: 'shape shape-arrow shape-in', x1, y1, x2, y2 })
    );
    const badge = stepBadge(x1, y1, a.step);
    if (badge) shapes.appendChild(badge);
    const lbl = shapeLabel((x1 + x2) / 2 + 6, (y1 + y2) / 2 - 8, a.label);
    if (lbl) shapes.appendChild(lbl);
    return;
  }

  // point: círculo pulsante + badge + etiqueta
  const cx = a.x * W;
  const cy = a.y * H;
  const ring = svgEl('circle', {
    class: 'shape shape-in',
    cx,
    cy,
    r: 16,
  });
  ring.style.animation = 'shape-march 1s linear infinite';
  shapes.appendChild(ring);
  shapes.appendChild(svgEl('circle', { class: 'badge-bg shape-in', cx, cy, r: 4 }));
  const badge = stepBadge(cx + 22, cy - 20, a.step);
  if (badge) shapes.appendChild(badge);
  const lbl = shapeLabel(cx + (Number.isFinite(a.step) ? 38 : 22), cy - 16, a.label);
  if (lbl) shapes.appendChild(lbl);
}

listen('overlay:point', (event) => {
  const payload = event.payload || {};
  const x = Number(payload.x);
  const y = Number(payload.y);
  dbgLog(`point x=${payload.x} y=${payload.y} "${payload.label ?? ''}"`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    dbgLog('  → coords no numéricas, ignoro');
    hideOverlay();
    return;
  }
  const px = clamp(x, 0, 1) * window.innerWidth;
  const py = clamp(y, 0, 1) * window.innerHeight;
  dbgLog(`  → px=${Math.round(px)} py=${Math.round(py)}`);
  flyTo(px, py, payload.label ? String(payload.label) : '');
});

listen('overlay:draw', (event) => {
  const list = Array.isArray(event.payload?.annotations) ? event.payload.annotations : [];
  dbgLog(`draw · ${list.length} figura(s): ${list.map((a) => a.kind).join(', ')}`);
  if (list.length === 0) {
    hideOverlay();
    return;
  }
  drawAnnotations(list);
});

listen('overlay:clear', () => {
  dbgLog('clear');
  hideOverlay();
});

// Estado de voz: 'idle' | 'listening' | 'processing'. Detalle aprendido de
// Clicky (CompanionManager.swift:593-598): al pasar a señalar hay que salir de
// 'processing' o el indicador tapa el vuelo del puntero.
listen('overlay:state', (event) => {
  const state = event.payload?.state || 'idle';
  voice.dataset.state = state;
  if (state !== 'idle') hideOverlay();
});

window.addEventListener('resize', hideOverlay);

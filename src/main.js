import './styles.css';
import cuteCatGif from './assets/cute-cat-white.gif';
import pawCursorWhite from './assets/pawboard/paw-cursor-white.png';
import { ConvexClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  createIcons,
  Minus,
  X,
  MoreHorizontal,
  Sparkles,
  BookOpen,
  Languages,
  Lightbulb,
  Paperclip,
  ScanLine,
  Mic,
  Send,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  LogOut,
  Plus,
} from 'lucide';

const AUTH_STORAGE = 'lumi.auth';
const THEME_STORAGE = 'lumi.theme';
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://accurate-bloodhound-858.convex.cloud';
const CONVEX_SITE = CONVEX_URL.replace('.convex.cloud', '.convex.site');
const AUTH_ERRORS = {
  InvalidSecret: 'CORREO O CONTRASEÑA INCORRECTOS.',
  InvalidAccountId: 'NO EXISTE UNA CUENTA CON ESE CORREO.',
  TooManyFailedAttempts: 'DEMASIADOS INTENTOS. ESPERA UN MOMENTO.',
};

function loadTokens() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE) || 'null');
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  if (!tokens?.token) {
    localStorage.removeItem(AUTH_STORAGE);
    return;
  }
  localStorage.setItem(AUTH_STORAGE, JSON.stringify(tokens));
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_STORAGE, next);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#f4f1e8' : '#111111');
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.setAttribute('aria-pressed', String(next === 'light'));
    button.setAttribute('aria-label', next === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
    button.innerHTML = `<i data-lucide="${next === 'light' ? 'moon' : 'sun'}"></i>`;
  });
  paintIcons();
}

function paintIcons(extra = {}) {
  createIcons({
    icons: {
      Minus, X, MoreHorizontal, Sparkles, BookOpen, Languages, Lightbulb, Paperclip, ScanLine, Mic, Send,
      ChevronLeft, ChevronRight, Sun, Moon, LogOut, Plus, ...extra,
    },
  });
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    html() {
      return '';
    },
  },
});

const MARKDOWN_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
  'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span',
];

function renderMarkdown(content) {
  const raw = String(content ?? '');
  try {
    const html = marked.parse(raw, { async: false });
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: MARKDOWN_TAGS,
      ALLOWED_ATTR: ['href', 'title', 'class', 'rel', 'target'],
    });
  } catch {
    return `<p>${escapeHtml(raw)}</p>`;
  }
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'AHORA';
  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

function mapAuthError(error) {
  const raw = String(error?.message || error || '');
  const code = Object.keys(AUTH_ERRORS).find((key) => raw.includes(key));
  if (code) return AUTH_ERRORS[code];
  if (/password/i.test(raw) && /8|length|short/i.test(raw)) return 'LA CONTRASEÑA DEBE TENER AL MENOS 8 CARACTERES.';
  if (/already/i.test(raw)) return 'ESE CORREO YA TIENE UNA CUENTA.';
  return raw.replace(/^\[.*?\]\s*/, '').toUpperCase() || 'NO SE PUDO COMPLETAR LA SOLICITUD.';
}

document.querySelector('#app').innerHTML = `
  <button class="collapse-handle" id="collapseWindow" type="button" aria-label="Colapsar ventana" aria-expanded="true">
    <i data-lucide="chevron-right"></i>
  </button>

  <section class="auth-screen" id="authScreen">
    <header class="auth-header">
      <span class="auth-index">01</span>
      <div class="auth-brand" aria-label="Michi Teach">MICHI TEACH</div>
      <div class="auth-system">
        <button class="icon-button" data-theme-toggle type="button" aria-label="Cambiar a modo claro"><i data-lucide="sun"></i></button>
        <button class="icon-button close" id="authClose" type="button" aria-label="Cerrar aplicación"><i data-lucide="x"></i></button>
      </div>
    </header>
    <div class="auth-body">
      <div class="auth-copy">
        <h1 id="authTitle">Bienvenido.</h1>
      </div>
      <form class="auth-form" id="loginForm">
        <label>
          <span>Correo electrónico</span>
          <input type="email" name="email" autocomplete="email" required placeholder="nombre@correo.com" />
        </label>
        <label>
          <span>Contraseña</span>
          <input type="password" name="password" autocomplete="current-password" minlength="8" required placeholder="Mínimo 8 caracteres" />
        </label>
        <button type="submit" class="auth-submit">Entrar <span>→</span></button>
      </form>
      <form class="auth-form auth-hidden" id="registerForm">
        <label>
          <span>Nombre</span>
          <input type="text" name="name" autocomplete="name" required placeholder="Tu nombre" />
        </label>
        <label>
          <span>Correo electrónico</span>
          <input type="email" name="email" autocomplete="email" required placeholder="nombre@correo.com" />
        </label>
        <label>
          <span>Contraseña</span>
          <input type="password" name="password" autocomplete="new-password" minlength="8" required placeholder="Mínimo 8 caracteres" />
        </label>
        <button type="submit" class="auth-submit">Registrar <span>→</span></button>
      </form>
      <p class="auth-status" id="authStatus" aria-live="polite"></p>
      <button class="auth-switch" id="authSwitch" type="button">¿Nuevo aquí? <b>Crear cuenta</b></button>
    </div>
    <footer class="auth-footer"><span>Sesión cifrada</span><span>Convex Auth</span></footer>
  </section>

  <section class="shell app-locked" id="assistantShell">
    <header class="titlebar" data-tauri-drag-region>
      <span class="auth-index">02</span>
      <div class="brand" data-tauri-drag-region>
        <div>
          <strong>Michi Teach</strong>
          <span id="userLabel">Tu profe personal</span>
        </div>
      </div>
      <div class="window-actions">
        <button class="icon-button" data-theme-toggle type="button" aria-label="Cambiar a modo claro"><i data-lucide="sun"></i></button>
        <button class="icon-button" id="minimize" aria-label="Minimizar"><i data-lucide="minus"></i></button>
        <button class="icon-button close" id="close" aria-label="Cerrar"><i data-lucide="x"></i></button>
      </div>
    </header>

    <div class="status-row">
      <span id="statusText">Nueva conversación</span>
      <button class="more" id="openDrawer" type="button" aria-label="Sesiones" aria-expanded="false"><i data-lucide="more-horizontal"></i></button>
    </div>

    <div class="chat" id="chat" aria-live="polite"></div>

    <aside class="drawer hidden" id="sessionDrawer">
      <h2>Sesiones</h2>
      <div class="thread-list" id="threadList"></div>
      <button class="drawer-new" id="newConversation" type="button">Nueva conversación <span>+</span></button>
      <button class="sign-out" id="signOut" type="button">Cerrar sesión</button>
    </aside>

    <footer class="composer-area">
      <div class="attach-chip hidden" id="attachChip">
        <span id="attachName">Imagen adjunta</span>
        <button type="button" id="clearAttach" aria-label="Quitar imagen">×</button>
      </div>
      <form class="composer" id="composer">
        <input class="hidden" id="imageInput" type="file" accept="image/*" />
        <button type="button" class="attach" id="captureButton" aria-label="Capturar mi pantalla" title="Capturar mi pantalla"><i data-lucide="scan-line"></i></button>
        <button type="button" class="attach" id="attachButton" aria-label="Adjuntar imagen"><i data-lucide="paperclip"></i></button>
        <img class="composer-cat" src="${cuteCatGif}" alt="" width="32" height="32" aria-hidden="true" />
        <textarea id="messageInput" rows="1" maxlength="500" placeholder="Pregúntale algo a Michi Teach..."></textarea>
        <button type="button" class="mic" aria-label="Mensaje de voz" disabled title="Próximamente"><i data-lucide="mic"></i></button>
        <button type="submit" class="send" aria-label="Enviar"><i data-lucide="send"></i></button>
      </form>
    </footer>
  </section>
`;

paintIcons();
applyTheme(currentTheme());

const chat = document.querySelector('#chat');
const form = document.querySelector('#composer');
const input = document.querySelector('#messageInput');
const authScreen = document.querySelector('#authScreen');
const assistantShell = document.querySelector('#assistantShell');
const loginForm = document.querySelector('#loginForm');
const registerForm = document.querySelector('#registerForm');
const authSwitch = document.querySelector('#authSwitch');
const authTitle = document.querySelector('#authTitle');
const authStatus = document.querySelector('#authStatus');
const sessionDrawer = document.querySelector('#sessionDrawer');
const threadList = document.querySelector('#threadList');
const attachChip = document.querySelector('#attachChip');
const imageInput = document.querySelector('#imageInput');

const convex = new ConvexClient(CONVEX_URL);
let registerMode = false;
let collapsed = false;
let collapseTransition = false;
let viewer = null;
let conversationId = null;
let conversations = [];
let pendingImage = null;
// 'file' cuando viene del clip (se persiste como miniatura en la burbuja) o
// 'capture' cuando viene del comando nativo `capture_screen` (no se persiste;
// el overlay es la retroalimentación visual). `null` si no hay imagen.
let pendingImageSource = null;
// Dimensiones de la última captura nativa, en píxeles. El overlay las usará
// para proyectar las coordenadas normalizadas 0..1 que devuelve el backend.
let captureDimensions = null;
let sending = false;
let unsubMessages = null;
let unsubConversations = null;
let unsubViewer = null;

async function fetchAccessToken({ forceRefreshToken }) {
  const stored = loadTokens();
  if (!stored?.token) return null;
  if (!forceRefreshToken) return stored.token;
  try {
    const result = await convex.action(anyApi.auth.signIn, { refreshToken: stored.refreshToken });
    if (result?.tokens?.token) {
      saveTokens(result.tokens);
      return result.tokens.token;
    }
  } catch {
    saveTokens(null);
  }
  return null;
}

function installAuth() {
  convex.setAuth(fetchAccessToken, (isAuthenticated) => {
    if (!isAuthenticated && viewer) showAuth();
  });
}

installAuth();

function emptyChatMarkup() {
  return `
    <div class="hero">
      <h1>Hola. Soy Michi Teach.</h1>
      <p>Compañero para aprender, practicar<br />y resolver esas dudas difíciles.</p>
    </div>
    <div class="quick-actions" id="quickActions">
      <button type="button" data-prompt="Explícame un tema paso a paso"><span class="quick-icon"><i data-lucide="sparkles"></i></span><span><b>Explícame un tema</b><small>Paso a paso y sin complicaciones</small></span></button>
      <button type="button" data-prompt="Ayúdame con mi tarea"><span class="quick-icon"><i data-lucide="book-open"></i></span><span><b>Ayuda con mi tarea</b><small>Resolvamos juntos el ejercicio</small></span></button>
      <button type="button" data-prompt="Quiero practicar otro idioma"><span class="quick-icon"><i data-lucide="languages"></i></span><span><b>Practicar idiomas</b><small>Conversa y mejora tu fluidez</small></span></button>
      <button type="button" data-prompt="Dame una idea para aprender algo nuevo"><span class="quick-icon"><i data-lucide="lightbulb"></i></span><span><b>Sorpréndeme</b><small>Aprende algo nuevo en 5 minutos</small></span></button>
    </div>
  `;
}

function bindQuickActions() {
  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => sendMessage(button.dataset.prompt));
  });
  paintIcons();
}

function renderEmptyChat() {
  chat.innerHTML = emptyChatMarkup();
  bindQuickActions();
}

function messageMarkup(message) {
  const isUser = message.role === 'user';
  const highlight = message.visualHighlight;
  const pin = highlight
    ? `<div class="pin"><span>X ${Number(highlight.x).toFixed(2)}</span><span>Y ${Number(highlight.y).toFixed(2)}</span><b>${escapeHtml(highlight.label || 'Elemento')}</b></div>`
    : '';
  const shot = message.screenshotUrl
    ? `<img class="shot" alt="Captura adjunta" src="${escapeHtml(message.screenshotUrl)}" />`
    : '';
  return `<div class="message ${isUser ? 'user-message' : 'lumi-message'}"><div class="bubble">${shot}<div class="md">${renderMarkdown(message.content)}</div>${pin}<small>${formatTime(message.createdAt)}</small></div></div>`;
}

function renderMessages(messages) {
  const typing = chat.querySelector('.typing-row');
  const visible = (messages || []).filter((item) => item.role !== 'system');
  if (!visible.length) {
    if (!typing) renderEmptyChat();
    return;
  }
  chat.innerHTML = visible.map(messageMarkup).join('');
  const lastIsAssistant = visible[visible.length - 1]?.role === 'assistant';
  if (typing && sending && !lastIsAssistant) chat.appendChild(typing);
  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
}

function showTyping(show) {
  chat.querySelector('.typing-row')?.remove();
  if (!show) return;
  document.querySelector('#quickActions')?.classList.add('hidden');
  const typing = document.createElement('div');
  typing.className = 'message lumi-message typing-row';
  typing.innerHTML = `<div class="bubble typing"><i></i><i></i><i></i></div>`;
  chat.appendChild(typing);
  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
}

function renderThreads() {
  if (!conversations.length) {
    threadList.innerHTML = '<p class="thread-empty">Aún no hay conversaciones.</p>';
    return;
  }
  threadList.innerHTML = conversations.map((item, index) => `
    <button type="button" data-id="${item._id}" class="${item._id === conversationId ? 'is-active' : ''}">
      <span class="drawer-index">${String(index + 1).padStart(2, '0')}</span>
      <span>${escapeHtml(item.title || 'Sin título')}</span>
      <small>${formatTime(item.createdAt)}</small>
    </button>
  `).join('');
  threadList.querySelectorAll('button[data-id]').forEach((button) => {
    button.addEventListener('click', () => {
      openConversation(button.dataset.id);
      sessionDrawer.classList.add('hidden');
      document.querySelector('#openDrawer').setAttribute('aria-expanded', 'false');
    });
  });
}

function currentConversationTitle() {
  const current = conversations.find((item) => item._id === conversationId);
  return current?.title || 'Nueva conversación';
}

function syncStatusTitle() {
  document.querySelector('#statusText').textContent = currentConversationTitle();
}

function showApp(user) {
  viewer = user;
  authScreen.classList.add('auth-hidden');
  assistantShell.classList.remove('app-locked');
  subscribeAppData();
}

function showAuth(message = '') {
  viewer = null;
  conversationId = null;
  conversations = [];
  unsubMessages?.();
  unsubConversations?.();
  unsubViewer?.();
  unsubMessages = unsubConversations = unsubViewer = null;
  assistantShell.classList.add('app-locked');
  authScreen.classList.remove('auth-hidden');
  sessionDrawer.classList.add('hidden');
  authStatus.textContent = message;
  authStatus.classList.toggle('is-ok', false);
  renderEmptyChat();
  syncStatusTitle();
}

function subscribeAppData() {
  unsubViewer?.();
  unsubConversations?.();
  unsubViewer = convex.onUpdate(anyApi.users.viewer, {}, (user) => {
    if (!user) {
      saveTokens(null);
      showAuth();
      return;
    }
    viewer = user;
  });
  unsubConversations = convex.onUpdate(anyApi.conversations.list, {}, (items) => {
    conversations = items || [];
    renderThreads();
    if (!conversationId && conversations[0]) openConversation(conversations[0]._id);
    if (!conversations.length) {
      conversationId = null;
      renderEmptyChat();
    }
    syncStatusTitle();
  });
}

function openConversation(id) {
  conversationId = id;
  unsubMessages?.();
  renderThreads();
  syncStatusTitle();
  unsubMessages = convex.onUpdate(anyApi.messages.list, { conversationId: id }, (messages) => {
    renderMessages(messages || []);
  });
}

async function startConversation(title) {
  const id = await convex.mutation(anyApi.conversations.create, { title });
  openConversation(id);
  return id;
}

authSwitch.addEventListener('click', () => {
  registerMode = !registerMode;
  loginForm.classList.toggle('auth-hidden', registerMode);
  registerForm.classList.toggle('auth-hidden', !registerMode);
  authTitle.textContent = registerMode ? 'Crear cuenta.' : 'Bienvenido.';
  authSwitch.innerHTML = registerMode ? '¿Ya tienes cuenta? <b>Iniciar sesión</b>' : '¿Nuevo aquí? <b>Crear cuenta</b>';
  authStatus.textContent = '';
});

async function submitAuth(flow, formEl) {
  const values = Object.fromEntries(new FormData(formEl));
  const submit = formEl.querySelector('[type="submit"]');
  authStatus.textContent = 'Conectando…';
  authStatus.classList.remove('is-ok');
  submit.disabled = true;
  try {
    const params = flow === 'signUp'
      ? { email: values.email, password: values.password, name: values.name, flow: 'signUp' }
      : { email: values.email, password: values.password, flow: 'signIn' };
    const result = await convex.action(anyApi.auth.signIn, { provider: 'password', params });
    if (!result?.tokens?.token) throw new Error('NO SE RECIBIÓ UNA SESIÓN VÁLIDA.');
    saveTokens(result.tokens);
    installAuth();
    const user = await convex.query(anyApi.users.viewer, {});
    formEl.reset();
    showApp(user || { email: values.email, name: values.name });
  } catch (error) {
    authStatus.textContent = mapAuthError(error);
  } finally {
    submit.disabled = false;
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth('signIn', loginForm);
});
registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth('signUp', registerForm);
});

async function sendMessage(text, { speakReply = false } = {}) {
  const clean = text.trim();
  if (!clean || sending) return;
  sending = true;
  form.querySelector('.send').disabled = true;
  try {
    if (!conversationId) {
      await startConversation(clean.slice(0, 42));
    }
    showTyping(true);
    input.value = '';
    input.style.height = 'auto';
    const wasCapture = pendingImageSource === 'capture';
    const reply = await convex.action(anyApi.messages.sendAndReply, {
      conversationId,
      content: clean,
      imageBase64: pendingImage || undefined,
    });
    pendingImage = null;
    pendingImageSource = null;
    attachChip.classList.add('hidden');
    imageInput.value = '';
    showTyping(false);
    handleAssistantReply(reply, { spoken: speakReply || wasCapture });
  } catch (error) {
    showTyping(false);
    chat.insertAdjacentHTML('beforeend', `<div class="message lumi-message"><div class="bubble"><p>${escapeHtml(mapAuthError(error))}</p><small>Ahora</small></div></div>`);
    chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
  } finally {
    sending = false;
    form.querySelector('.send').disabled = false;
  }
}

// Tras cada respuesta del asistente: si trae coordenadas, manda el puntero del
// overlay al elemento; si la consulta vino por captura o por voz, lee la
// explicación en voz alta. La burbuja de chat sigue actualizándose por la
// suscripción reactiva; esto es solo la capa visual/sonora extra.
function handleAssistantReply(reply, { spoken = false } = {}) {
  if (!reply) return;
  const hl = reply.visualHighlight;
  const annotations = Array.isArray(reply.annotations) ? reply.annotations : [];
  console.info('[michi] respuesta:', {
    annotations,
    visualHighlight: hl,
    detectedTool: reply.detectedTool,
  });
  if (annotations.length > 0) {
    emit('overlay:draw', { annotations })
      .then(() => console.info('[michi] overlay:draw emitido', annotations.length))
      .catch((e) => console.warn('[michi] overlay:draw falló', e));
  } else if (hl && Number.isFinite(hl.x) && Number.isFinite(hl.y)) {
    const payload = { x: hl.x, y: hl.y, label: hl.label || reply.detectedTool || '' };
    emit('overlay:point', payload)
      .then(() => console.info('[michi] overlay:point emitido', payload))
      .catch((e) => console.warn('[michi] overlay:point falló', e));
  } else {
    emit('overlay:clear').catch(() => {});
  }
  if (spoken && reply.content) speak(reply.content);
}

let ttsVoice = null;
function pickSpanishVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  ttsVoice =
    voices.find((v) => /^es(-|_|$)/i.test(v.lang) && /female|mónica|monica|paulina/i.test(v.name)) ||
    voices.find((v) => /^es(-|_|$)/i.test(v.lang)) ||
    null;
}
if (window.speechSynthesis) {
  pickSpanishVoice();
  window.speechSynthesis.addEventListener('voiceschanged', pickSpanishVoice);
}

let ttsAudio = null;

function stopSpeaking() {
  window.speechSynthesis?.cancel();
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio.src = '';
    ttsAudio = null;
  }
}

// Lee el texto en voz alta. Primero intenta Fish Audio (voz neural, vía Convex);
// si no hay llave configurada o falla, cae a `speechSynthesis` del navegador.
async function speak(text) {
  stopSpeaking();
  try {
    const res = await convex.action(anyApi.speech.synthesize, { text });
    if (res?.audioBase64) {
      ttsAudio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`);
      ttsAudio.addEventListener('ended', () => {
        ttsAudio = null;
      });
      await ttsAudio.play();
      return;
    }
  } catch (error) {
    console.warn('Fish Audio no disponible, uso la voz del navegador:', error);
  }
  speakWithBrowser(text);
}

function speakWithBrowser(text) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  if (ttsVoice) utterance.voice = ttsVoice;
  utterance.rate = 1.02;
  synth.speak(utterance);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
});

document.querySelector('#attachButton').addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingImage = String(reader.result);
    pendingImageSource = 'file';
    captureDimensions = null;
    document.querySelector('#attachName').textContent = file.name;
    attachChip.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

// Pide una captura nativa al comando de Rust y la deja lista como `pendingImage`.
// Devuelve true si funcionó.
async function runCapture() {
  try {
    const shot = await invoke('capture_screen');
    pendingImage = shot.imageBase64;
    pendingImageSource = 'capture';
    captureDimensions = { width: shot.width, height: shot.height };
    document.querySelector('#attachName').textContent = 'Captura de pantalla';
    attachChip.classList.remove('hidden');
    return true;
  } catch (error) {
    console.error('No se pudo capturar la pantalla:', error);
    // El comando de Rust devuelve un string con el motivo (p. ej. permiso de
    // grabación). Lo mostramos tal cual en vez de un mensaje genérico.
    const detail = typeof error === 'string' ? error : error?.message || String(error);
    document.querySelector('#attachName').textContent = detail;
    attachChip.classList.remove('hidden');
    return false;
  }
}

const captureButton = document.querySelector('#captureButton');
captureButton.addEventListener('click', async () => {
  if (captureButton.disabled) return;
  captureButton.disabled = true;
  try {
    if (await runCapture()) input.focus();
  } finally {
    captureButton.disabled = false;
  }
});

document.querySelector('#clearAttach').addEventListener('click', () => {
  pendingImage = null;
  pendingImageSource = null;
  captureDimensions = null;
  imageInput.value = '';
  attachChip.classList.add('hidden');
});

// ---------- Voz: push-to-talk → captura + grabación → transcripción → envío ----------
const micButton = document.querySelector('.composer .mic');
let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;
let voiceBusy = false;
// El push-to-talk es Ctrl+Option (macOS) / Ctrl+Alt (Windows) — solo
// modificadores, sin tecla. Rust vigila el estado global y emite
// `ptt:pressed` al mantenerlos y `ptt:released` al soltar cualquiera.
let pttHeld = false;

function setVoiceState(state) {
  micButton?.classList.toggle('is-live', state === 'listening');
  micButton?.classList.toggle('is-busy', state === 'processing');
  emit('overlay:state', { state }).catch(() => {});
}

// Muestra un aviso del flujo de voz como burbuja en el chat, para que los
// fallos (permiso de micro, llave de transcripción, audio vacío…) no pasen
// desapercibidos.
function voiceNote(message) {
  if (!chat) return;
  chat.insertAdjacentHTML(
    'beforeend',
    `<div class="message lumi-message"><div class="bubble"><p>${escapeHtml(message)}</p><small>Ahora</small></div></div>`
  );
  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function startVoiceCapture() {
  if (voiceBusy || mediaRecorder) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    voiceNote('El micrófono no está disponible en este contexto (getUserMedia).');
    return;
  }
  stopSpeaking(); // corta cualquier respuesta que se esté leyendo
  // La captura va ANTES de grabar, para que la respuesta pueda señalar en pantalla.
  await runCapture();
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    console.error('No se pudo abrir el micrófono:', error);
    const name = error?.name || '';
    voiceNote(
      name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Falta el permiso de Micrófono para la app. Actívalo en Ajustes del Sistema → Privacidad y seguridad → Micrófono y relanza.'
        : `No pude abrir el micrófono: ${name || error}`
    );
    setVoiceState('idle');
    return;
  }
  audioChunks = [];
  try {
    mediaRecorder = new MediaRecorder(recordingStream);
  } catch (error) {
    console.error('MediaRecorder no soportado:', error);
    voiceNote(`Este entorno no soporta grabación de audio: ${error}`);
    recordingStream.getTracks().forEach((t) => t.stop());
    recordingStream = null;
    setVoiceState('idle');
    return;
  }
  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) audioChunks.push(event.data);
  });
  // timeslice: acumula trozos durante la grabación en vez de depender del
  // dataavailable final (más fiable en WKWebView).
  mediaRecorder.start(200);
  setVoiceState('listening');
  // Si soltaron las teclas mientras se abría el micro, cortar ya.
  if (!pttHeld && pttDriven) stopVoiceCapture();
}

// true solo mientras el disparo actual venga del atajo global (no del botón).
let pttDriven = false;

async function stopVoiceCapture() {
  if (!mediaRecorder) return;
  const recorder = mediaRecorder;
  mediaRecorder = null;
  const mimeType = recorder.mimeType || 'audio/webm';
  const stopped = new Promise((resolve) =>
    recorder.addEventListener('stop', resolve, { once: true })
  );
  try {
    recorder.requestData();
  } catch {
    // algunos navegadores no lo permiten justo antes de stop; no pasa nada
  }
  recorder.stop();
  await stopped;
  recordingStream?.getTracks().forEach((track) => track.stop());
  recordingStream = null;

  const blob = new Blob(audioChunks, { type: mimeType });
  audioChunks = [];
  if (blob.size < 1200) {
    setVoiceState('idle');
    voiceNote('No se escuchó nada. Mantén Ctrl+Option (o Ctrl+Alt) mientras hablas y suelta al terminar.');
    return;
  }

  setVoiceState('processing');
  voiceBusy = true;
  try {
    const audioBase64 = await blobToBase64(blob);
    const { text } = await convex.action(anyApi.transcription.transcribe, {
      audioBase64,
      mimeType,
    });
    if (text && text.trim()) {
      await sendMessage(text.trim(), { speakReply: true });
    } else {
      voiceNote('No entendí lo que dijiste. Intenta de nuevo, más cerca del micrófono.');
    }
  } catch (error) {
    console.error('La transcripción falló:', error);
    voiceNote(`La transcripción falló: ${error?.message || error}`);
  } finally {
    voiceBusy = false;
    setVoiceState('idle');
  }
}

listen('ptt:pressed', () => {
  pttHeld = true;
  pttDriven = true;
  startVoiceCapture();
}).catch(() => {});
listen('ptt:released', () => {
  pttHeld = false;
  stopVoiceCapture();
}).catch(() => {});

if (micButton) {
  micButton.disabled = false;
  micButton.removeAttribute('title');
  micButton.setAttribute('aria-label', 'Hablar (o mantén Ctrl+Option / Ctrl+Alt)');
  micButton.addEventListener('click', () => {
    if (mediaRecorder) {
      stopVoiceCapture();
    } else {
      pttDriven = false;
      startVoiceCapture();
    }
  });
}

document.querySelector('#openDrawer').addEventListener('click', () => {
  const open = sessionDrawer.classList.toggle('hidden');
  document.querySelector('#openDrawer').setAttribute('aria-expanded', String(!open));
});
document.querySelector('#newConversation').addEventListener('click', async () => {
  await startConversation('Nueva conversación');
  renderEmptyChat();
  sessionDrawer.classList.add('hidden');
});
document.querySelector('#signOut').addEventListener('click', async () => {
  try {
    await convex.action(anyApi.auth.signOut, {});
  } catch { /* La sesión local se limpia de todos modos. */ }
  saveTokens(null);
  installAuth();
  showAuth();
});

document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
  button.addEventListener('click', () => applyTheme(currentTheme() === 'light' ? 'dark' : 'light'));
});

async function windowAction(action) {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow()[action]();
  } catch { /* En el navegador los controles son decorativos. */ }
}
document.querySelector('#minimize').addEventListener('click', () => windowAction('minimize'));
document.querySelector('#close').addEventListener('click', () => invoke('quit_app'));
document.querySelector('#authClose').addEventListener('click', () => invoke('quit_app'));

document.querySelector('#collapseWindow').addEventListener('click', async () => {
  if (collapseTransition) return;
  collapseTransition = true;
  const nextCollapsed = !collapsed;
  const handle = document.querySelector('#collapseWindow');
  handle.disabled = true;
  try {
    await invoke('set_collapsed', { collapsed: nextCollapsed });
  } catch (error) {
    if (window.__TAURI_INTERNALS__) {
      console.error('No se pudo cambiar el tamaño de la ventana:', error);
      handle.classList.add('collapse-error');
      window.setTimeout(() => handle.classList.remove('collapse-error'), 700);
      handle.disabled = false;
      collapseTransition = false;
      return;
    }
  }
  collapsed = nextCollapsed;
  document.body.classList.toggle('window-collapsed', collapsed);
  handle.setAttribute('aria-expanded', String(!collapsed));
  handle.setAttribute('aria-label', collapsed ? 'Expandir ventana' : 'Colapsar ventana');
  handle.innerHTML = `<i data-lucide="${collapsed ? 'chevron-left' : 'chevron-right'}"></i>`;
  paintIcons();
  handle.disabled = false;
  collapseTransition = false;
});

async function checkHealth() {
  try {
    await fetch(`${CONVEX_SITE}/api/health`);
  } catch {}
  syncStatusTitle();
}

async function restoreSession() {
  renderEmptyChat();
  await checkHealth();
  if (!loadTokens()?.token) return;
  try {
    const user = await convex.query(anyApi.users.viewer, {});
    if (user) showApp(user);
    else showAuth();
  } catch {
    saveTokens(null);
  }
}

restoreSession();

function installPawTrail() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const POOL = 6;
  const MAX_VISIBLE = 5;
  const MIN_DISTANCE = 42;

  const layer = document.createElement('div');
  layer.className = 'paw-trail';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);

  const stamps = Array.from({ length: POOL }, () => {
    const img = document.createElement('img');
    img.src = pawCursorWhite;
    img.alt = '';
    img.draggable = false;
    img.dataset.status = 'inactive';
    layer.appendChild(img);
    return img;
  });

  let globalIndex = 0;
  let last = { x: 0, y: 0 };

  function activate(img, x, y) {
    img.style.left = `${x}px`;
    img.style.top = `${y}px`;
    img.style.setProperty('--rotation', `${Math.random() * 30 - 15}deg`);
    img.dataset.status = 'active';
    last = { x, y };
    window.setTimeout(() => {
      if (img.dataset.status === 'active') img.dataset.status = 'inactive';
    }, 520);
  }

  function onMove(point) {
    if (document.body.classList.contains('window-collapsed')) return;
    const x = point.clientX;
    const y = point.clientY;
    if (Math.hypot(x - last.x, y - last.y) <= MIN_DISTANCE) return;

    const lead = stamps[globalIndex % stamps.length];
    const tailIndex = globalIndex >= MAX_VISIBLE
      ? (globalIndex - MAX_VISIBLE) % stamps.length
      : -1;
    if (lead) activate(lead, x, y);
    if (tailIndex >= 0) stamps[tailIndex].dataset.status = 'inactive';
    globalIndex += 1;
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('touchmove', (event) => {
    if (event.touches[0]) onMove(event.touches[0]);
  }, { passive: true });
}

installPawTrail();

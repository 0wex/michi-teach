import './styles.css';
import mascot from './assets/lumi-mascot.png';
import { ConvexClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { invoke } from '@tauri-apps/api/core';
import { createIcons, Minus, X, MoreHorizontal, Sparkles, BookOpen, Languages, Lightbulb, Paperclip, Mic, Send, ChevronLeft, ChevronRight, LogIn } from 'lucide';

document.querySelector('#app').innerHTML = `
  <button class="collapse-handle" id="collapseWindow" type="button" aria-label="Colapsar ventana" aria-expanded="true">
    <i data-lucide="chevron-right"></i>
  </button>
  <section class="auth-screen" id="authScreen">
    <header class="auth-header">
      <span class="auth-index">01</span>
      <div class="auth-brand" aria-label="Michi Teach">MICHI TEACH</div>
      <div class="auth-system">
        <button class="auth-close" id="authClose" type="button" aria-label="Cerrar aplicación">×</button>
      </div>
    </header>

    <div class="auth-copy">
      <p>ASISTENTE DE APRENDIZAJE</p>
      <h1 id="authTitle">BIENVENIDO.</h1>
    </div>

    <form class="auth-form" id="loginForm">
      <label>
        <span>CORREO ELECTRÓNICO</span>
        <input type="email" name="email" autocomplete="email" required placeholder="nombre@correo.com" />
      </label>
      <label>
        <span>CONTRASEÑA</span>
        <input type="password" name="password" autocomplete="current-password" minlength="6" required placeholder="••••••••" />
      </label>
      <button type="submit" class="auth-submit">ENTRAR <span>→</span></button>
    </form>

    <form class="auth-form auth-hidden" id="registerForm">
      <label>
        <span>NOMBRE</span>
        <input type="text" name="name" autocomplete="name" required placeholder="Tu nombre" />
      </label>
      <label>
        <span>CORREO ELECTRÓNICO</span>
        <input type="email" name="email" autocomplete="email" required placeholder="nombre@correo.com" />
      </label>
      <label>
        <span>CONTRASEÑA</span>
        <input type="password" name="password" autocomplete="new-password" minlength="6" required placeholder="Mínimo 6 caracteres" />
      </label>
      <button type="submit" class="auth-submit">REGISTRAR <span>→</span></button>
    </form>

    <p class="auth-status" id="authStatus" aria-live="polite"></p>
    <button class="auth-switch" id="authSwitch" type="button">¿NUEVO AQUÍ? <b>CREAR CUENTA</b></button>
    <footer class="auth-footer"><span>PRIVADO</span><span>SIN ALMACENAMIENTO LOCAL</span></footer>
  </section>

  <section class="shell app-locked" id="assistantShell">
    <header class="titlebar" data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <div class="brand-mark"><img src="${mascot}" alt="Lumi" /></div>
        <div>
          <strong>Lumi</strong>
          <span>Tu profe personal</span>
        </div>
      </div>
      <div class="window-actions">
        <button class="icon-button account-button" id="openLogin" aria-label="Ir al inicio de sesión" title="Inicio de sesión"><i data-lucide="log-in"></i></button>
        <button class="icon-button" id="minimize" aria-label="Minimizar"><i data-lucide="minus"></i></button>
        <button class="icon-button close" id="close" aria-label="Cerrar"><i data-lucide="x"></i></button>
      </div>
    </header>

    <div class="status-row">
      <span class="online-dot"></span>
      <span>Disponible para ayudarte</span>
      <button class="more" aria-label="Más opciones"><i data-lucide="more-horizontal"></i></button>
    </div>

    <div class="chat" id="chat" aria-live="polite">
      <div class="hero">
        <div class="mascot-wrap">
          <span class="spark one">✦</span><span class="spark two">✦</span>
          <img src="${mascot}" alt="Lumi, tu búho profesor" />
        </div>
        <h1>¡Hola! Soy Lumi <span>👋</span></h1>
        <p>Tu compañero para aprender, practicar<br />y resolver esas dudas difíciles.</p>
      </div>

      <div class="message lumi-message">
        <div class="mini-avatar"><img src="${mascot}" alt="" /></div>
        <div class="bubble">
          <p>¿Qué te gustaría aprender hoy?</p>
          <small>10:24</small>
        </div>
      </div>

      <div class="quick-actions" id="quickActions">
        <button data-prompt="Explícame un tema paso a paso"><span class="quick-icon coral"><i data-lucide="sparkles"></i></span><span><b>Explícame un tema</b><small>Paso a paso y sin complicaciones</small></span></button>
        <button data-prompt="Ayúdame con mi tarea"><span class="quick-icon mint"><i data-lucide="book-open"></i></span><span><b>Ayuda con mi tarea</b><small>Resolvamos juntos el ejercicio</small></span></button>
        <button data-prompt="Quiero practicar otro idioma"><span class="quick-icon blue"><i data-lucide="languages"></i></span><span><b>Practicar idiomas</b><small>Conversa y mejora tu fluidez</small></span></button>
        <button data-prompt="Dame una idea para aprender algo nuevo"><span class="quick-icon yellow"><i data-lucide="lightbulb"></i></span><span><b>Sorpréndeme</b><small>Aprende algo nuevo en 5 minutos</small></span></button>
      </div>
    </div>

    <footer class="composer-area">
      <form class="composer" id="composer">
        <button type="button" class="attach" aria-label="Adjuntar"><i data-lucide="paperclip"></i></button>
        <textarea id="messageInput" rows="1" maxlength="500" placeholder="Pregúntale algo a Lumi..."></textarea>
        <button type="button" class="mic" aria-label="Mensaje de voz"><i data-lucide="mic"></i></button>
        <button type="submit" class="send" aria-label="Enviar"><i data-lucide="send"></i></button>
      </form>
      <p>Lumi puede equivocarse. Verifica la información importante.</p>
    </footer>
  </section>
`;

createIcons({ icons: { Minus, X, MoreHorizontal, Sparkles, BookOpen, Languages, Lightbulb, Paperclip, Mic, Send, ChevronLeft, ChevronRight, LogIn } });

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
const convexUrl = import.meta.env.VITE_CONVEX_URL;
const convex = convexUrl ? new ConvexClient(convexUrl) : null;
let registerMode = false;
let collapsed = false;
let collapseTransition = false;
let account = null;
let conversationId = null;

// Convex adjunta el mensaje del servidor en error.data cuando se lanza un ConvexError.
function extractError(error) {
  if (error && typeof error.data === 'string') return error.data;
  const raw = (error && error.message) || String(error || '');
  const match = raw.match(/Uncaught (?:Convex)?Error:\s*(.+)/) || raw.match(/Error:\s*(.+)/);
  return (match ? match[1] : raw).split('\n')[0].replace(/\s+at\s+.*/, '').trim().slice(0, 160);
}

authSwitch.addEventListener('click', () => {
  registerMode = !registerMode;
  loginForm.classList.toggle('auth-hidden', registerMode);
  registerForm.classList.toggle('auth-hidden', !registerMode);
  authTitle.textContent = registerMode ? 'CREAR CUENTA.' : 'BIENVENIDO.';
  authSwitch.innerHTML = registerMode ? '¿YA TIENES CUENTA? <b>INICIAR SESIÓN</b>' : '¿NUEVO AQUÍ? <b>CREAR CUENTA</b>';
  authStatus.textContent = '';
});

async function submitAuth(kind, form) {
  if (!convex) {
    authStatus.textContent = 'FALTA CONFIGURAR VITE_CONVEX_URL.';
    return;
  }
  const values = Object.fromEntries(new FormData(form));
  const submitButton = form.querySelector('.auth-submit');
  authStatus.textContent = 'CONECTANDO…';
  if (submitButton) submitButton.disabled = true;
  try {
    account = await convex.mutation(anyApi.accounts[kind], values);
    form.reset();
    authStatus.textContent = '';
    authScreen.classList.add('auth-hidden');
    assistantShell.classList.remove('app-locked');
  } catch (error) {
    authStatus.textContent = (extractError(error) || 'NO SE PUDO CONECTAR CON EL SERVIDOR.').toUpperCase();
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth('login', loginForm);
});

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth('register', registerForm);
});

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function appendLumi(text) {
  chat.insertAdjacentHTML(
    'beforeend',
    `<div class="message lumi-message"><div class="mini-avatar"><img src="${mascot}" alt="" /></div><div class="bubble"><p>${escapeHtml(text)}</p><small>Ahora</small></div></div>`
  );
  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
}

async function sendMessage(text) {
  const clean = text.trim();
  if (!clean) return;
  document.querySelector('#quickActions')?.classList.add('hidden');
  chat.insertAdjacentHTML('beforeend', `<div class="message user-message"><div class="bubble"><p>${escapeHtml(clean)}</p><small>Ahora</small></div></div>`);
  const typing = document.createElement('div');
  typing.className = 'message lumi-message typing-row';
  typing.innerHTML = `<div class="mini-avatar"><img src="${mascot}" alt="" /></div><div class="bubble typing"><i></i><i></i><i></i></div>`;
  chat.appendChild(typing);
  input.value = '';
  input.style.height = 'auto';
  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });

  if (!convex) {
    typing.remove();
    appendLumi('Configura VITE_CONVEX_URL para conectar con el asistente.');
    return;
  }

  try {
    if (!conversationId) {
      conversationId = await convex.mutation(anyApi.conversations.create, { title: clean.slice(0, 48) });
    }
    const reply = await convex.action(anyApi.messages.sendAndReply, { conversationId, content: clean });
    typing.remove();
    appendLumi(reply?.content || 'No recibí respuesta del asistente.');
  } catch (error) {
    typing.remove();
    appendLumi(`No pude conectar con el asistente. ${extractError(error)}`.trim());
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(input.value); });
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
});
document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.prompt)));

async function windowAction(action) {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow()[action]();
  } catch { /* Browser preview: window controls are decorative. */ }
}
document.querySelector('#minimize').addEventListener('click', () => windowAction('minimize'));
document.querySelector('#close').addEventListener('click', () => invoke('quit_app'));
document.querySelector('#authClose').addEventListener('click', () => invoke('quit_app'));
document.querySelector('#openLogin').addEventListener('click', () => {
  account = null;
  conversationId = null;
  assistantShell.classList.add('app-locked');
  authScreen.classList.remove('auth-hidden');
  registerMode = false;
  loginForm.classList.remove('auth-hidden');
  registerForm.classList.add('auth-hidden');
  authTitle.textContent = 'BIENVENIDO.';
  authSwitch.innerHTML = '¿NUEVO AQUÍ? <b>CREAR CUENTA</b>';
  authStatus.textContent = '';
  window.setTimeout(() => loginForm.elements.email?.focus(), 50);
});

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
    /* La previsualización web conserva únicamente el estado visual. */
  }

  collapsed = nextCollapsed;
  document.body.classList.toggle('window-collapsed', collapsed);
  handle.setAttribute('aria-expanded', String(!collapsed));
  handle.setAttribute('aria-label', collapsed ? 'Expandir ventana' : 'Colapsar ventana');
  handle.innerHTML = `<i data-lucide="${collapsed ? 'chevron-left' : 'chevron-right'}"></i>`;
  createIcons({ icons: { ChevronLeft, ChevronRight } });
  handle.disabled = false;
  collapseTransition = false;
});

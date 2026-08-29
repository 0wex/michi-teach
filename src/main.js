import './styles.css';
import mascot from './assets/lumi-mascot.png';
import { ConvexClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { invoke } from '@tauri-apps/api/core';
import { createIcons, ChevronLeft, Minus, X, MoreHorizontal, Sparkles, BookOpen, Languages, Lightbulb, Paperclip, Mic, Send } from 'lucide';

document.querySelector('#app').innerHTML = `
  <section class="auth-screen" id="authScreen">
    <button class="collapse-button auth-header-collapse" data-collapse aria-label="Colapsar panel"><i data-lucide="chevron-left"></i></button>
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
    <button class="collapse-button" data-collapse aria-label="Ocultar en el borde derecho"><i data-lucide="chevron-left"></i></button>
    <header class="titlebar" data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <div class="brand-mark"><img src="${mascot}" alt="Lumi" /></div>
        <div>
          <strong>Lumi</strong>
          <span>Tu profe personal</span>
        </div>
      </div>
      <div class="window-actions">
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

createIcons({ icons: { ChevronLeft, Minus, X, MoreHorizontal, Sparkles, BookOpen, Languages, Lightbulb, Paperclip, Mic, Send } });

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
let collapsed = false;
let registerMode = false;

authSwitch.addEventListener('click', () => {
  registerMode = !registerMode;
  loginForm.classList.toggle('auth-hidden', registerMode);
  registerForm.classList.toggle('auth-hidden', !registerMode);
  authTitle.textContent = registerMode ? 'CREAR CUENTA.' : 'BIENVENIDO.';
  authSwitch.innerHTML = registerMode ? '¿YA TIENES CUENTA? <b>INICIAR SESIÓN</b>' : '¿NUEVO AQUÍ? <b>CREAR CUENTA</b>';
  authStatus.textContent = '';
});

async function submitAuth(kind, form) {
  const values = Object.fromEntries(new FormData(form));
  authStatus.textContent = 'CONECTANDO…';
  try {
    if (convex) {
      await convex.mutation(anyApi.auth[kind], values);
    }
    form.reset();
    authScreen.classList.add('auth-hidden');
    assistantShell.classList.remove('app-locked');
  } catch {
    authStatus.textContent = 'NO SE PUDO CONECTAR CON CONVEX.';
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
  if (convex) {
    convex.mutation(anyApi.messages.send, { body: clean }).catch(console.error);
  }
  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
  window.setTimeout(() => {
    typing.remove();
    chat.insertAdjacentHTML('beforeend', `<div class="message lumi-message"><div class="mini-avatar"><img src="${mascot}" alt="" /></div><div class="bubble"><p>¡Buena pregunta! Esta demo ya tiene lista la experiencia de conversación. El siguiente paso es conectar tu modelo de IA para responder sobre <b>${escapeHtml(clean.toLowerCase())}</b>.</p><small>Ahora</small></div></div>`);
    chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
  }, 900);
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

async function toggleCollapse() {
  collapsed = !collapsed;
  document.body.classList.toggle('collapsed', collapsed);
  document.querySelectorAll('[data-collapse]').forEach((button) => {
    button.setAttribute('aria-label', collapsed ? 'Mostrar panel' : 'Colapsar panel');
    button.querySelector('svg').style.transform = collapsed ? 'rotate(180deg)' : '';
  });
  await invoke('set_collapsed', { collapsed });
}

document.querySelectorAll('[data-collapse]').forEach((button) => button.addEventListener('click', toggleCollapse));

if (convex) {
  convex.onUpdate(anyApi.messages.list, {}, () => {});
}

import { searchOnline, targetInstant, realTime, realClock, localDay, validDate, validClock, nearestAvailable, R } from './core.js?v=6';

const $ = s => document.querySelector(s), form = $('#search-form'), result = $('#result');
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';
const DEMO_DAY = '2026-10-23', DEMO_NOW = Date.parse('2026-10-25T12:00:00-03:00');
const dataBase = demo ? 'data/demo/' : 'data/';

$('#demo-notice').hidden = !demo;
const today = localDay();
let redirTimer = null, fromParams = false;
const UA = navigator.userAgent || '';
const ANDROID = /Android/i.test(UA), MOBILE = ANDROID || /iPhone|iPad|iPod/i.test(UA);
// En el celular se abre la app de YouTube: en Android con un enlace "intent" (si no la tiene, cae a la web);
// en iPhone el enlace https normal, que el sistema entrega a la app si está instalada.
function appUrl(url) {
  if (!ANDROID) return url;
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.google.android.youtube;` +
    `S.browser_fallback_url=${encodeURIComponent(url)};end`;
}
const WD = d => new Date(d + 'T12:00:00Z').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const cap = t => t[0].toUpperCase() + t.slice(1);
const pad = n => String(n).padStart(2, '0');
const top = demo ? DEMO_DAY : today;

function setDay(v) {
  $('#day').value = v;
  $('#day-text').textContent = cap(WD(v)) + (demo ? '' : v === today ? ' (hoy)' : v === addDays(today, -1) ? ' (ayer)' : '');
}
function setTime(v) { $('#time').value = v; $('#time-text').textContent = `${v.slice(0, 5)} hs`; }
setDay(top);
setTime('20:05');

// ---- Ventana de selección (calendario / hora), centrada en PC y desde abajo en el celular ----
const sheet = $('#sheet'), sbody = $('#sheet-body');
let lastFocus = null;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function openSheet(render) {
  lastFocus = document.activeElement; render(); sheet.hidden = false; document.body.classList.add('noscroll');
  (sbody.querySelector('[aria-pressed="true"]') || sbody.querySelector('button:not(:disabled)'))?.focus();
}
function closeSheet() { sheet.hidden = true; document.body.classList.remove('noscroll'); lastFocus && lastFocus.focus && lastFocus.focus(); }
sheet.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
function btn(text, onclick, extra = {}) {
  const b = el('button', extra.cls, text); b.type = 'button'; b.onclick = onclick;
  if (extra.disabled) b.disabled = true; if (extra.pressed) b.setAttribute('aria-pressed', 'true'); if (extra.label) b.setAttribute('aria-label', extra.label);
  return b;
}
function renderCal(y, m) {
  const [ty, tm] = top.split('-').map(Number), sel = $('#day').value;
  const first = new Date(Date.UTC(y, m - 1, 1)), offset = (first.getUTCDay() + 6) % 7, dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const go = d => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); renderCal(t.getUTCFullYear(), t.getUTCMonth() + 1); };
  const head = el('div', 'sh-head');
  head.append(btn('‹', () => go(-1), { cls: 'sh-nav', label: 'Mes anterior', disabled: y * 12 + m <= 2026 * 12 + 9 }),
    el('div', 'sh-title', cap(first.toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }))),
    btn('›', () => go(1), { cls: 'sh-nav', label: 'Mes siguiente', disabled: y * 12 + m >= ty * 12 + tm }));
  const grid = el('div', 'cal');
  ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(w => grid.append(el('span', 'wd', w)));
  for (let i = 0; i < offset; i++) grid.append(el('span'));
  for (let d = 1; d <= dim; d++) {
    const ds = `${y}-${pad(m)}-${pad(d)}`;
    grid.append(btn(String(d), () => { setDay(ds); closeSheet(); preview(); },
      { disabled: ds > top, pressed: ds === sel, cls: ds === today ? 'today' : '', label: cap(WD(ds)) }));
  }
  const foot = el('div', 'sh-foot');
  foot.append(btn('Cerrar', closeSheet), ...(demo ? [] : [btn('Hoy', () => { setDay(today); closeSheet(); preview(); }, { cls: 'go' })]));
  sbody.replaceChildren(head, grid, foot);
}
function renderHours() {
  const cur = $('#time').value.slice(0, 2);
  sbody.replaceChildren(el('div', 'sh-head', ''), el('p', 'sh-sub', 'Tocá la hora (la hora a la que jugaste, no la de ahora).'));
  sbody.firstChild.append(el('div', 'sh-title', '¿A qué hora jugaste?'));
  const g = el('div', 'grid4');
  for (let h = 0; h < 24; h++) g.append(btn(pad(h), () => renderMinutes(pad(h)), { pressed: pad(h) === cur }));
  const foot = el('div', 'sh-foot'); foot.append(btn('Cerrar', closeSheet));
  sbody.append(g, foot);
}
function renderMinutes(hh) {
  const cur = $('#time').value;
  const head = el('div', 'sh-head');
  head.append(btn('‹', renderHours, { cls: 'sh-nav', label: 'Cambiar la hora' }), el('div', 'sh-title', `${hh}:__  ¿y los minutos?`));
  const g = el('div', 'grid4');
  for (let m = 0; m < 60; m += 5) { const v = `${hh}:${pad(m)}`; g.append(btn(v, () => { setTime(v); closeSheet(); preview(); }, { pressed: v === cur.slice(0, 5) })); }
  const foot = el('div', 'sh-foot'); foot.append(btn('Cerrar', closeSheet));
  sbody.replaceChildren(head, el('p', 'sh-sub', 'Elegí lo más parecido. Después podés ajustar de a 5 minutos.'), g, foot);
  sbody.querySelector('.grid4 button')?.focus();
}
$('#day-btn').onclick = () => { const [y, m] = $('#day').value.split('-').map(Number); openSheet(() => renderCal(y, m)); };
$('#time-btn').onclick = () => openSheet(renderHours);

// Enlaces duraderos: ?cancha=1&fecha=2026-10-31&hora=20:09:42 (resuelve siempre la versión vigente).
const courtParam = params.get('cancha'), dayParam = params.get('fecha'), timeParam = params.get('hora');
if (['1', '2', '3'].includes(courtParam)) form.elements.court.value = courtParam;
if (dayParam && validDate(dayParam)) setDay(dayParam);
if (timeParam && validClock(timeParam)) {
  setTime(timeParam.slice(0, 5));
  if (timeParam.length === 8) $('#time').value = timeParam;  // conserva los segundos del enlace
}

function preview() {
  try { $('#date-preview').textContent = `Vas a buscar: ${realTime(targetInstant($('#day').value, $('#time').value))}.`; }
  catch { $('#date-preview').textContent = ''; }
  $('#day-help').hidden = Number($('#time').value.slice(0, 2)) >= 6;
  $('#recent-note').hidden = demo || $('#day').value < addDays(today, -3);
  updateStage();
}
// La tarjeta de la cancha muestra la búsqueda actual: cancha, día y el minuto sobre la línea de la noche (19:00 a 03:00).
function updateStage() {
  const t = $('#time').value || '20:05', court = form.elements.court.value;
  const [h, m] = t.split(':').map(Number), mins = ((h * 60 + m - 19 * 60) % 1440 + 1440) % 1440;
  $('#st-title').textContent = `${court ? 'Cancha ' + court : 'Tu partido'} · ${t.slice(0, 5)}`;
  $('#st-day').textContent = cap(WD($('#day').value)).replace(/^(\S{3})\S*,?\s/, '$1 ');
  $('#st-time').textContent = t.length === 5 ? `${t}:00` : t;
  $('#st-mk').style.left = `${Math.min(mins / 480 * 100, 98)}%`;
}
form.addEventListener('input', () => { clearTimeout(redirTimer); preview(); });
document.querySelectorAll('[data-shift]').forEach(b => b.onclick = () => {
  const [h, m] = $('#time').value.split(':').map(Number);
  const t = ((h * 60 + m + Number(b.dataset.shift)) % 1440 + 1440) % 1440;
  setTime(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  clearTimeout(redirTimer); preview();
});
preview();
$('#search-button').disabled = false;
result.textContent = demo ? 'Probá Cancha 2 · 23/10/2026 · 00:30. La demo simula una consulta posterior a esa jornada.' : 'Para empezar, tocá tu cancha.';

const messages = {
  future: ['Todavía no llegó ese momento', 'Elegí una fecha y hora que ya hayan pasado.'],
  [R.NOT_PUBLISHED]: ['El video todavía no está disponible', 'Los videos se suben con demora: puede tardar unos días después del partido. Volvé a probar más tarde. Si pasó más de una semana, consultá en el complejo.'],
  [R.PROCESSING]: ['El video se está preparando', 'Ya está en camino. Volvé a probar más tarde.'],
  [R.NOT_RECORDED]: ['No hay grabación para esa hora', 'Para esta cancha y jornada no existe grabación en el horario que elegiste.'],
  [R.GAP]: ['Hubo una interrupción en la grabación', 'Este momento no está disponible porque hubo un corte en la grabación.'],
  [R.UNVERIFIED]: ['Este video no se puede buscar por horario', 'No pudimos verificar la correspondencia entre horarios y video de esta jornada. Consultá en el complejo.'],
  [R.REMOVED]: ['Video no disponible', 'Este video fue retirado. Consultá en el complejo.'],
  [R.ERROR]: ['No pudimos completar la búsqueda', 'Puede ser un problema momentáneo. Probá de nuevo en unos minutos.'],
};

function node(tag, text, cls) { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; }
const fmtDay = d => d.split('-').reverse().join('/');
// Une tramos pegados (microcortes de la cámara) para que la lista de horarios sea legible.
const mergeIv = list => {
  const out = [];
  for (const iv of [...list].sort((x, y) => Date.parse(x.real_start) - Date.parse(y.real_start))) {
    const last = out[out.length - 1];
    if (last && Date.parse(iv.real_start) - Date.parse(last.real_end) <= 2000) last.real_end = iv.real_end;
    else out.push({ real_start: iv.real_start, real_end: iv.real_end });
  }
  return out;
};
const span = iv => `${realClock(Date.parse(iv.real_start))} → ${realClock(Date.parse(iv.real_end))}`;

form.onsubmit = async e => {
  e.preventDefault();
  clearTimeout(redirTimer);
  const auto = !fromParams; fromParams = false;
  let tab = null, navigated = false;
  const court = form.elements.court.value, day = $('#day').value, time = $('#time').value;
  if (!court) { result.replaceChildren(node('h3', 'Falta elegir la cancha'), node('p', 'Tocá Cancha 1, 2 o 3 en la parte de arriba y volvé a apretar “Ver mi partido”.')); return; }
  // La pestaña nueva se abre ya (con el toque del usuario) para que el navegador no la bloquee; después se le pone el link.
  if (auto && !demo && !MOBILE) {
    try { tab = window.open('', '_blank'); if (tab) { tab.opener = null; tab.document.title = 'Mi partido'; tab.document.body.style.cssText = 'font:18px sans-serif;background:#14372f;color:#c8ef7e;display:grid;place-items:center;height:100vh;margin:0'; tab.document.body.textContent = 'Buscando tu partido…'; } } catch { tab = null; }
  }
  result.replaceChildren(document.createTextNode('Buscando tu partido…'));
  $('#search-button').disabled = true;
  try {
    const target = targetInstant(day, time);
    if (target > (demo ? DEMO_NOW : Date.now())) { show({ result: 'future' }); return; }
    let found = await searchOnline({ court, day, time }, dataBase);
    let ctx = { court, day, target };
    // Si justo esa hora cayó en un corte (o muy cerca de la grabación), va al momento grabado más cercano.
    if ((found.result === R.GAP || found.result === R.NOT_RECORDED) && found.available && found.available.length) {
      const near = nearestAvailable(found.available, target, found.result === R.GAP ? Infinity : 15 * 60);
      if (near) {
        const alt = await searchOnline({ court, day, time: realClock(near.ms, true) }, dataBase);
        if (alt.result === R.AVAILABLE) {
          ctx = { court, day, target: near.ms, asked: target, distance: near.distance_s, side: near.side };
          found = alt;
        }
      }
    }
    show(found, ctx);
    if (found.result === R.AVAILABLE && !demo && auto) {
      if (MOBILE) {    // en el celular no se abre nada solo: el botón "Ver en YouTube" lo abre con un toque (así abre la app)
        history.replaceState(null, '', `?cancha=${court}&fecha=${day}&hora=${time}`);   // "volver" regresa a esta pantalla
        result.append(node('p', 'Listo, encontramos tu partido. Tocá el botón verde para abrirlo en YouTube.', 'redir'));
        setTimeout(() => result.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
      } else if (tab) { tab.location.href = found.url; navigated = true; result.append(node('p', 'Abrimos tu partido en otra pestaña de YouTube.', 'redir')); }
      else result.append(node('p', 'Tu navegador bloqueó la pestaña nueva: tocá el botón verde para abrir el video.', 'redir'));
    }
    if (!demo) history.replaceState(null, '', `?cancha=${court}&fecha=${day}&hora=${time}`);
  } catch (err) {
    result.replaceChildren(node('h3', 'No pudimos cargar las grabaciones'), node('p', 'Revisá tu conexión. '));
    const b = node('button', 'Reintentar'); b.type = 'button'; b.onclick = () => form.requestSubmit(); result.append(b);
  } finally {
    if (tab && !navigated) { try { tab.close(); } catch {} }
    $('#search-button').disabled = false;
  }
};

function show(found, ctx = {}) {
  result.replaceChildren();
  if (found.result !== R.AVAILABLE) {
    const [title, body] = messages[found.result] || messages[R.ERROR];
    result.append(node('h3', title), node('p', body));
    if (found.gap) result.append(node('p', `Interrupción: ${span(found.gap)}.`));
    if (found.available && found.available.length) result.append(node('small', `Horarios disponibles: ${mergeIv(found.available).map(span).join(' · ')}.`));
    return;
  }
  const s = found.start_seconds;
  result.append(node('span', demo ? 'Simulación ficticia' : 'Grabación encontrada', 'badge'),
    node('h3', `Cancha ${found.court_number} · Mi partido`),
    node('p', `${ctx.asked ? 'Momento más cercano' : 'Tu momento'}: ${realTime(ctx.target)} · Desde ${Math.floor(s / 3600) ? Math.floor(s / 3600) + ' h ' : ''}${Math.floor(s % 3600 / 60)} min ${s % 60} s del video.`));
  if (ctx.asked) {
    const min = ctx.distance >= 90 ? `${Math.round(ctx.distance / 60)} min` : `${Math.round(ctx.distance)} s`;
    result.append(node('small', `A las ${realClock(ctx.asked)} no hay grabación. Te llevamos al momento ` +
      `grabado más cercano: ${realClock(ctx.target)}, ${min} ${ctx.side === 'before' ? 'antes' : 'después'}.`));
  }
  if (found.snapped_seconds > 0) result.append(node('small', `Hubo un microcorte de la cámara: el video arranca ${found.snapped_seconds.toFixed(1)} s después.`));
  if (demo) result.append(node('p', 'Cálculo correcto. En la versión real este botón abre el video; la demo no usa enlaces a partidos.'));
  else { const a = node('a', 'Ver en YouTube ', 'primary'); a.insertAdjacentHTML('beforeend', '<svg class="arr" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>'); a.href = MOBILE ? appUrl(found.url) : found.url; a.target = MOBILE ? '_self' : '_blank'; a.rel = 'noopener noreferrer'; result.append(a, node('small', 'Se abre YouTube justo en ese momento del partido.')); }
  result.append(node('small', `Cancha ${found.court_number} · Jornada ${fmtDay(found.sport_date)} · Video versión ${found.video_version}.`));
}

if (courtParam && dayParam && timeParam) { fromParams = true; form.requestSubmit(); }

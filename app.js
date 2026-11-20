import { searchOnline, targetInstant, realTime, realClock, localDay, validDate, validClock, nearestAvailable, R } from './core.js';

const $ = s => document.querySelector(s), form = $('#search-form'), result = $('#result');
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';
const DEMO_DAY = '2026-10-23', DEMO_NOW = Date.parse('2026-10-25T12:00:00-03:00');
const dataBase = demo ? 'data/demo/' : 'data/';

$('#demo-notice').hidden = !demo;
const today = localDay();
$('#day').max = demo ? DEMO_DAY : today;
$('#day').value = demo ? DEMO_DAY : today;

// Enlaces duraderos: ?cancha=1&fecha=2026-10-31&hora=20:09:42 (resuelve siempre la versión vigente).
const courtParam = params.get('cancha'), dayParam = params.get('fecha'), timeParam = params.get('hora');
if (['1', '2', '3'].includes(courtParam)) form.elements.court.value = courtParam;
if (dayParam && validDate(dayParam)) $('#day').value = dayParam;
if (timeParam && validClock(timeParam)) {
  if (timeParam.length === 8) $('#time').step = 1;  // mostrar segundos
  $('#time').value = timeParam;
}

function preview() {
  try { $('#date-preview').textContent = `Vas a buscar el ${realTime(targetInstant($('#day').value, $('#time').value))} (hora real de Mendoza).`; }
  catch { $('#date-preview').textContent = ''; }
}
form.addEventListener('input', preview);
document.querySelectorAll('[data-shift]').forEach(b => b.onclick = () => {
  const [h, m] = $('#time').value.split(':').map(Number);
  const t = ((h * 60 + m + Number(b.dataset.shift)) % 1440 + 1440) % 1440;
  $('#time').value = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  preview();
});
preview();
$('#search-button').disabled = false;
result.textContent = demo ? 'Probá Cancha 2 · 23/10/2026 · 00:30. La demo simula una consulta posterior a esa jornada.' : 'Todo listo. Elegí cuándo jugaste.';

const messages = {
  future: ['Todavía no llegó ese momento', 'Elegí una fecha y hora que ya hayan pasado.'],
  [R.NOT_PUBLISHED]: ['El video todavía no está disponible', 'El video de esta cancha y fecha todavía no se publicó. Las grabaciones se publican al día siguiente. Si pasaron varios días, consultá en el complejo.'],
  [R.PROCESSING]: ['El video se está preparando', 'Ya está en camino. Volvé a probar más tarde.'],
  [R.NOT_RECORDED]: ['No hay grabación para esa hora', 'Para esta cancha y jornada no existe grabación en el horario que elegiste.'],
  [R.GAP]: ['Hubo una interrupción en la grabación', 'Este momento no está disponible porque hubo un corte en la grabación.'],
  [R.UNVERIFIED]: ['Este video no se puede buscar por horario', 'No pudimos verificar la correspondencia entre horarios y video de esta jornada. Consultá en el complejo.'],
  [R.REMOVED]: ['Video no disponible', 'Este video fue retirado. Consultá en el complejo.'],
  [R.ERROR]: ['No pudimos completar la búsqueda', 'Puede ser un problema momentáneo. Probá de nuevo en unos minutos.'],
};

function node(tag, text, cls) { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; }
const fmtDay = d => d.split('-').reverse().join('/');
const span = iv => `${realClock(Date.parse(iv.real_start))} → ${realClock(Date.parse(iv.real_end))}`;

form.onsubmit = async e => {
  e.preventDefault();
  const court = form.elements.court.value, day = $('#day').value, time = $('#time').value;
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
    if (!demo) history.replaceState(null, '', `?cancha=${court}&fecha=${day}&hora=${time}`);
  } catch (err) {
    result.replaceChildren(node('h3', 'No pudimos cargar las grabaciones'), node('p', 'Revisá tu conexión. '));
    const b = node('button', 'Reintentar'); b.type = 'button'; b.onclick = () => form.requestSubmit(); result.append(b);
  } finally {
    $('#search-button').disabled = false;
  }
};

function show(found, ctx = {}) {
  result.replaceChildren();
  if (found.result !== R.AVAILABLE) {
    const [title, body] = messages[found.result] || messages[R.ERROR];
    result.append(node('h3', title), node('p', body));
    if (found.gap) result.append(node('p', `Interrupción: ${span(found.gap)}.`));
    if (found.available && found.available.length) result.append(node('small', `Horarios disponibles: ${found.available.map(span).join(' · ')}.`));
    return;
  }
  const s = found.start_seconds;
  result.append(node('span', demo ? 'SIMULACIÓN FICTICIA' : 'GRABACIÓN ENCONTRADA', 'badge'),
    node('h3', `Cancha ${found.court_number} · Mi partido`),
    node('p', `${ctx.asked ? 'Momento más cercano' : 'Tu momento'}: ${realTime(ctx.target)} · Desde ${Math.floor(s / 3600) ? Math.floor(s / 3600) + ' h ' : ''}${Math.floor(s % 3600 / 60)} min ${s % 60} s del video.`));
  if (ctx.asked) {
    const min = ctx.distance >= 90 ? `${Math.round(ctx.distance / 60)} min` : `${Math.round(ctx.distance)} s`;
    result.append(node('small', `A las ${realClock(ctx.asked)} no hay imagen (corte en la grabación). Te llevamos al momento ` +
      `grabado más cercano: ${realClock(ctx.target)}, ${min} ${ctx.side === 'before' ? 'antes' : 'después'}.`));
  }
  if (found.snapped_seconds > 0) result.append(node('small', `Hubo un microcorte de la cámara: el video arranca ${found.snapped_seconds.toFixed(1)} s después.`));
  if (demo) result.append(node('p', 'Cálculo correcto. En la versión real este botón abre el video; la demo no usa enlaces a partidos.'));
  else { const a = node('a', 'Ver en YouTube ↗', 'primary'); a.href = found.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; result.append(a); }
  result.append(node('small', `Cancha ${found.court_number} · Jornada ${fmtDay(found.sport_date)} · Video versión ${found.video_version}.`));
}

if (courtParam && dayParam && timeParam) form.requestSubmit();

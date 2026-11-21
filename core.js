// TuPartido · lógica de búsqueda (contrato de metadatos v1 del extractor De Volea).
//
// Datos publicados (todo estático):
//   data/index/AAAA-MM-DD.json            índice de la fecha deportiva: versión ACTIVA por cancha
//   data/manifests/<jornada>/vN.json      manifiesto inmutable: ID de YouTube + mapa temporal
//
// Reglas:
// - El segundo del video sale SIEMPRE del mapa temporal (tramos reales -> posiciones), nunca de
//   "hora pedida - hora de inicio". Así un corte en la grabación no corre el resto del partido.
// - El índice guarda el sha256 de los bytes exactos del manifiesto: si no coinciden, no hay enlace.
// - Intervalos semiabiertos [inicio, fin). Horas 00:00–05:59 = madrugada siguiente a la fecha elegida.
// Esta implementación se prueba contra tests/vectors/tupartido_v1.json (mismos casos que el extractor).

export const ZONE = 'America/Argentina/Mendoza';
export const OFFSET = '-03:00';          // Mendoza no tiene horario de verano.
export const SCHEMA_MAJOR = '1';
export const CONTINUITY_S = 1.5;         // microcortes de la cámara (resolución de 1 s)

export const R = {
  AVAILABLE: 'AVAILABLE', NOT_RECORDED: 'NOT_RECORDED', GAP: 'GAP', NOT_PUBLISHED: 'NOT_PUBLISHED',
  PROCESSING: 'PROCESSING', UNVERIFIED: 'UNVERIFIED', REMOVED: 'REMOVED', ERROR: 'ERROR',
};

export function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
}

export function validClock(s) {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
}

export function localDay(instant = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

// Fecha deportiva + hora -> instante (ms). Antes del corte (06:00) cae en el día siguiente.
export function targetInstant(day, time, cutoff = '06:00') {
  if (!validDate(day) || !validClock(time)) throw Error('Revisá la fecha y la hora.');
  const hms = time.length === 5 ? `${time}:00` : time;
  const cut = cutoff.length === 5 ? `${cutoff}:00` : cutoff;
  const ms = Date.parse(`${day}T${hms}${OFFSET}`);
  return ms + (hms < cut ? 86400000 : 0);
}

// "2026-11-01T00:05:00.000-03:00" (mismo formato que el extractor)
export function isoMendoza(ms) {
  const d = new Date(ms - 3 * 3600000);
  return d.toISOString().replace('Z', OFFSET);
}

export function realTime(ms) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: ZONE, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}

export function realClock(ms, seconds = false) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' }).format(new Date(ms));
}

export function youtubeUrl(videoId, seconds) {
  return `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`;
}

export async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const fail = (result, extra = {}) => ({ result, ...extra });

// Resolutor determinista. loadManifest(path) -> Promise<Uint8Array> con los bytes publicados.
export async function resolveQuery(index, loadManifest, courtNumber, sportDate, clock) {
  try {
    if (!index || String(index.schema_version || '').split('.')[0] !== SCHEMA_MAJOR) return fail(R.ERROR, { detail: 'version de contrato incompatible' });
    if (index.sport_date !== sportDate) return fail(R.ERROR, { detail: 'indice de otra fecha' });
    const entry = (index.journeys || []).find(e => e.court_number === courtNumber);
    if (!entry) return fail(R.NOT_PUBLISHED);
    const pub = entry.publication_status;
    if (pub === 'removed') return fail(R.REMOVED);
    if (pub === 'uploading' || pub === 'processing') return fail(R.PROCESSING);
    if (pub !== 'public' || !entry.active) return fail(R.NOT_PUBLISHED);

    const active = entry.active;
    const raw = await loadManifest(active.manifest);
    if (await sha256Hex(raw) !== active.manifest_sha256) return fail(R.ERROR, { detail: 'manifiesto no coincide con el indice' });
    const man = JSON.parse(new TextDecoder('utf-8').decode(raw));
    if (man.video_version !== active.video_version || man.youtube_video_id !== active.youtube_video_id ||
        man.court_number !== courtNumber || man.sport_date !== sportDate || man.journey_id !== entry.journey_id) {
      return fail(R.ERROR, { detail: 'manifiesto incoherente' });
    }
    if (man.status !== 'complete' && man.status !== 'partial') return fail(R.UNVERIFIED);
    if (man.timezone !== ZONE) return fail(R.ERROR, { detail: 'zona horaria inesperada' });

    const when = targetInstant(sportDate, clock, man.day_cutoff);
    const base = { journey_id: man.journey_id, court_number: courtNumber, court_name: man.court_name,
      sport_date: sportDate, requested: isoMendoza(when), video_version: man.video_version };
    const tl = man.timeline;
    for (let i = 0; i < tl.length; i++) {
      const a = Date.parse(tl[i].real_start), b = Date.parse(tl[i].real_end);
      if (a <= when && when < b) {
        const pos = tl[i].video_start + (when - a) / 1000;
        if (!(tl[i].video_start <= pos && pos < tl[i].video_end) || pos >= man.video_duration_seconds) return fail(R.ERROR, { detail: 'posicion fuera del video' });
        const sec = Math.floor(pos + 1e-9);
        return { ...base, result: R.AVAILABLE, youtube_video_id: man.youtube_video_id, start_seconds: sec,
          url: youtubeUrl(man.youtube_video_id, sec), snapped_seconds: 0 };
      }
      if (i + 1 < tl.length) {
        const na = Date.parse(tl[i + 1].real_start);
        if (b <= when && when < na && (na - b) / 1000 <= CONTINUITY_S) {
          const sec = Math.floor(tl[i + 1].video_start + 1e-9);
          return { ...base, result: R.AVAILABLE, youtube_video_id: man.youtube_video_id, start_seconds: sec,
            url: youtubeUrl(man.youtube_video_id, sec), snapped_seconds: Math.round((na - when)) / 1000 };
        }
      }
    }
    const available = tl.map(e => ({ real_start: e.real_start, real_end: e.real_end }));
    const first = Date.parse(tl[0].real_start), last = Date.parse(tl[tl.length - 1].real_end);
    for (const g of man.gaps) {
      if (Date.parse(g.real_start) <= when && when < Date.parse(g.real_end)) {
        if (g.reason === 'not_recovered' || (first < when && when < last)) return { ...base, result: R.GAP, gap: g, available };
      }
    }
    return { ...base, result: R.NOT_RECORDED, available };
  } catch (err) {
    return fail(R.ERROR, { detail: String(err && err.message || err) });
  }
}

// Carga desde el sitio: índice de la fecha + manifiesto activo.
export async function searchOnline({ court, day, time }, base = 'data/') {
  if (!validDate(day) || !validClock(time)) throw Error('Revisá la fecha y la hora.');
  const res = await fetch(`${base}index/${day}.json`, { cache: 'no-cache' });
  if (res.status === 404) return fail(R.NOT_PUBLISHED);
  if (!res.ok) throw Error('No pudimos cargar las grabaciones.');
  const index = await res.json();
  const loadManifest = async path => {
    const r = await fetch(base + path, { cache: 'no-cache' });
    if (!r.ok) throw Error('manifiesto no disponible');
    return new Uint8Array(await r.arrayBuffer());
  };
  return resolveQuery(index, loadManifest, Number(court), day, time);
}

/**
 * Registro de respuestas del taller de sesgos.
 *
 * Recibe un POST del navegador y añade una fila a respuestas.csv en GitHub
 * mediante la API de contenidos. El token de GitHub vive como secreto del
 * Worker; nunca se envía al navegador.
 *
 * Variables de entorno (ver wrangler.toml):
 *   GITHUB_REPO      samorwno/taller-sesgos-entrevista
 *   CSV_PATH         respuestas.csv
 *   BRANCH           main
 *   ALLOWED_ORIGINS  https://samorwno.github.io,http://localhost:8000
 *   GITHUB_TOKEN     secreto (fine-grained, Contents: Read and write)
 */

const CSV_COLUMNS = [
  'id',
  'fecha_inicio',
  'fecha_cierre',
  'duracion_min',
  'nombre',
  'puntaje',
  'total',
  'porcentaje',
  'nivel'
]
  .concat(Array.from({ length: 12 }, (_, i) => 'r' + String(i + 1).padStart(2, '0')))
  .concat(Array.from({ length: 12 }, (_, i) => 'ok' + String(i + 1).padStart(2, '0')));

const MAX_BODY_BYTES = 20000;
const MAX_NAME_LENGTH = 120;
const TOTAL_ITEMS = 12;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const cors = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!allowed.length) {
      return json({ ok: false, error: 'El Worker no tiene orígenes configurados.' }, 500, cors);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Método no permitido.' }, 405, cors);
    }

    if (!allowed.includes(origin)) {
      return json({ ok: false, error: 'Origen no permitido.' }, 403, cors);
    }

    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
      return json({ ok: false, error: 'El registro no está configurado.' }, 500, cors);
    }

    let raw;
    try {
      raw = await request.text();
    } catch (error) {
      return json({ ok: false, error: 'No se pudo leer la solicitud.' }, 400, cors);
    }

    if (raw.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'Solicitud demasiado grande.' }, 413, cors);
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      return json({ ok: false, error: 'JSON inválido.' }, 400, cors);
    }

    const entry = validate(payload);
    if (entry.error) {
      return json({ ok: false, error: entry.error }, 400, cors);
    }

    try {
      const result = await appendRow(entry, env);
      return json({ ok: true, duplicado: result.duplicado, fila: result.fila }, 200, cors);
    } catch (error) {
      console.error('registro:', error && error.message ? error.message : error);
      return json({ ok: false, error: 'No se pudo escribir el registro.' }, 502, cors);
    }
  }
};

function corsHeaders(origin, allowed) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      extraHeaders || {}
    )
  });
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') return { error: 'Datos incompletos.' };

  const id = String(payload.id || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{7,80}$/.test(id)) {
    return { error: 'Identificador inválido.' };
  }

  const nombre = String(payload.nombre || '').replace(/\s+/g, ' ').trim();
  if (nombre.length < 3 || nombre.length > MAX_NAME_LENGTH) {
    return { error: 'Nombre inválido.' };
  }
  if (/[\u0000-\u001f\u007f]/.test(nombre)) {
    return { error: 'Nombre inválido.' };
  }

  const inicio = normalizeDate(payload.inicio);
  const cierre = normalizeDate(payload.cierre);
  if (!inicio || !cierre) return { error: 'Fechas inválidas.' };
  if (new Date(cierre).getTime() < new Date(inicio).getTime()) {
    return { error: 'Fechas inválidas.' };
  }

  if (!Array.isArray(payload.respuestas) || payload.respuestas.length !== TOTAL_ITEMS) {
    return { error: 'Respuestas incompletas.' };
  }

  const answers = [];
  for (let i = 0; i < payload.respuestas.length; i += 1) {
    const answer = payload.respuestas[i];
    if (!answer || answer.item !== i + 1) return { error: 'Reactivo inválido.' };
    if (!Number.isInteger(answer.opcion) || answer.opcion < 0 || answer.opcion > 3) {
      return { error: 'Respuesta inválida.' };
    }
    if (!Number.isInteger(answer.correcta) || answer.correcta < 0 || answer.correcta > 3) {
      return { error: 'Clave inválida.' };
    }
    answers.push({ opcion: answer.opcion, correcta: answer.correcta });
  }

  const puntaje = answers.filter((answer) => answer.opcion === answer.correcta).length;
  const porcentaje = Math.round((puntaje / TOTAL_ITEMS) * 1000) / 10;
  const duracion = Math.max(
    1,
    Math.round((new Date(cierre).getTime() - new Date(inicio).getTime()) / 60000)
  );

  const cells = [
    id,
    inicio,
    cierre,
    duracion,
    nombre,
    puntaje,
    TOTAL_ITEMS,
    porcentaje,
    levelFor(porcentaje)
  ];

  answers.forEach((answer) => {
    cells.push(['A', 'B', 'C', 'D'][answer.opcion]);
  });
  answers.forEach((answer) => {
    cells.push(answer.opcion === answer.correcta ? 1 : 0);
  });

  return { id: id, row: cells.map(csvEscape).join(',') };
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 2020 || year > 2100) return null;
  return date.toISOString();
}

// Mantener sincronizado con levelFor() de index.html.
function levelFor(porcentaje) {
  if (porcentaje >= 85) return 'Dominio analítico sobresaliente';
  if (porcentaje >= 70) return 'Criterio metodológico sólido';
  if (porcentaje >= 50) return 'Competencia en consolidación';
  return 'Requiere refuerzo metodológico';
}

function csvEscape(value) {
  let text = String(value == null ? '' : value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function contentsUrl(env) {
  const repo = String(env.GITHUB_REPO || '').trim();
  const path = String(env.CSV_PATH || 'respuestas.csv').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('GITHUB_REPO inválido');
  }
  if (!path || path.includes('..')) throw new Error('CSV_PATH inválido');
  return (
    'https://api.github.com/repos/' +
    repo +
    '/contents/' +
    path.split('/').map(encodeURIComponent).join('/')
  );
}

function githubHeaders(env) {
  return {
    Authorization: 'Bearer ' + env.GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'taller-sesgos-worker'
  };
}

async function readCsv(env) {
  const branch = env.BRANCH || 'main';
  const response = await fetch(contentsUrl(env) + '?ref=' + encodeURIComponent(branch), {
    headers: githubHeaders(env)
  });

  if (response.status === 404) return { text: '', sha: null };
  if (!response.ok) throw new Error('GitHub GET ' + response.status);

  const data = await response.json();
  if (data.truncated) throw new Error('El CSV supera el límite de la API.');
  return {
    text: data.content ? base64ToUtf8(data.content) : '',
    sha: data.sha || null
  };
}

async function appendRow(entry, env) {
  const branch = env.BRANCH || 'main';
  const url = contentsUrl(env);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readCsv(env);

    if (
      current.text
        .split(/\r?\n/)
        .some((line) => line.startsWith(entry.id + ','))
    ) {
      return { duplicado: true, fila: countRows(current.text) };
    }

    let text = current.text;
    if (!text.trim()) text = CSV_COLUMNS.join(',') + '\n';
    else if (!text.endsWith('\n')) text += '\n';
    text += entry.row + '\n';

    const body = {
      message: 'Taller de sesgos: nuevo registro',
      content: utf8ToBase64(text),
      branch: branch
    };
    if (current.sha) body.sha = current.sha;

    const response = await fetch(url, {
      method: 'PUT',
      headers: Object.assign({}, githubHeaders(env), {
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(body)
    });

    if (response.ok) {
      return { duplicado: false, fila: countRows(text) };
    }

    if (response.status === 409 || response.status === 422) {
      continue; // Otro registro cambió el archivo: se reintenta con el sha nuevo.
    }

    throw new Error('GitHub PUT ' + response.status);
  }

  throw new Error('No se pudo guardar tras varios intentos.');
}

function countRows(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  return Math.max(0, trimmed.split(/\r?\n/).length - 1);
}

function base64ToUtf8(value) {
  const binary = atob(String(value).replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

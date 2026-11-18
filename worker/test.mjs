import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const ORIGIN = 'https://samorwno.github.io';

const ENV = {
  GITHUB_TOKEN: 'token-de-prueba',
  GITHUB_REPO: 'samorwno/taller-sesgos-entrevista',
  CSV_PATH: 'respuestas.csv',
  BRANCH: 'main',
  ALLOWED_ORIGINS: 'https://samorwno.github.io,http://localhost:8000'
};

function createMock() {
  const mock = { csv: '', sha: 0, puts: 0, conflictOnce: false };

  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const parsed = new URL(String(url));
    if (parsed.hostname !== 'api.github.com') {
      throw new Error('URL inesperada: ' + url);
    }

    if (method === 'GET') {
      if (!mock.csv) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      return new Response(
        JSON.stringify({
          content: Buffer.from(mock.csv, 'utf8').toString('base64'),
          sha: 'sha-' + mock.sha
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'PUT') {
      if (mock.conflictOnce) {
        mock.conflictOnce = false;
        return new Response(JSON.stringify({ message: 'Conflict' }), { status: 409 });
      }
      const body = JSON.parse(init.body);
      if (body.sha && body.sha !== 'sha-' + mock.sha) {
        return new Response(JSON.stringify({ message: 'Conflict' }), { status: 409 });
      }
      mock.csv = Buffer.from(body.content, 'base64').toString('utf8');
      mock.sha += 1;
      mock.puts += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    throw new Error('Método inesperado: ' + method);
  };

  return mock;
}

function payload(overrides = {}) {
  const base = {
    id: '11111111-2222-3333-4444-555555555555',
    nombre: 'María José Ospina',
    inicio: '2026-11-18T13:00:00.000Z',
    cierre: '2026-11-18T13:18:00.000Z',
    respuestas: Array.from({ length: 12 }, (_, i) => ({
      item: i + 1,
      opcion: 0,
      correcta: i === 0 ? 0 : 1
    }))
  };
  return Object.assign(base, overrides);
}

function call(body, origin = ORIGIN, env = ENV) {
  return worker.fetch(
    new Request('https://worker.example/', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
    env
  );
}

test('acepta un registro y crea el encabezado', async () => {
  const mock = createMock();
  const response = await call(payload());
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.duplicado, false);
  assert.equal(mock.puts, 1);

  const lines = mock.csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split(',').length, 33);
  assert.equal(lines[1].split(',').length, 33);
  assert.match(lines[1], /María José Ospina/);
  assert.equal(lines[1].split(',')[5], '1');
  assert.equal(lines[1].split(',')[7], '8.3');
});

test('no duplica un envío con el mismo id', async () => {
  const mock = createMock();
  await call(payload());
  const response = await call(payload());
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.duplicado, true);
  assert.equal(mock.puts, 1);
  assert.equal(mock.csv.trim().split('\n').length, 2);
});

test('rechaza orígenes no permitidos', async () => {
  createMock();
  const response = await call(payload(), 'https://ejemplo.com');
  assert.equal(response.status, 403);
});

test('rechaza respuestas incompletas', async () => {
  createMock();
  const response = await call(payload({ respuestas: [] }));
  assert.equal(response.status, 400);
});

test('rechaza fechas invertidas', async () => {
  createMock();
  const response = await call(payload({ inicio: '2026-11-18T14:00:00.000Z', cierre: '2026-11-18T13:00:00.000Z' }));
  assert.equal(response.status, 400);
});

test('reintenta si el archivo cambió durante la escritura', async () => {
  const mock = createMock();
  mock.conflictOnce = true;
  const response = await call(payload({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }));
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(mock.puts, 1);
  assert.match(mock.csv, /aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/);
});

test('neutraliza fórmulas y comas en el nombre', async () => {
  const mock = createMock();
  const response = await call(
    payload({
      id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      nombre: '=HYPERLINK("http://x"), Pérez'
    })
  );

  assert.equal(response.status, 200);
  assert.match(mock.csv, /"'=HYPERLINK\(""http:\/\/x""\), Pérez"/);
});

test('responde al preflight CORS', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN }
    }),
    ENV
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('exige configuración del Worker', async () => {
  createMock();
  const response = await call(payload(), ORIGIN, {
    GITHUB_REPO: 'samorwno/taller-sesgos-entrevista',
    ALLOWED_ORIGINS: ORIGIN
  });
  assert.equal(response.status, 500);
});

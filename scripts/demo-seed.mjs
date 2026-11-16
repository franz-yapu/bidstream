#!/usr/bin/env node
// Siembra datos de demostración en un `make demo` en marcha: subastas con lotes, postores con nombre
// público y pujas, para ver el sitio con contenido. Solo usa la API pública, como cualquier cliente.
// Lee la contraseña del administrador de `.env.auth.private` (no versionado) y crea postores con
// contraseñas aleatorias que no se guardan ni se muestran.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const API = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? '3000'}`;
const TENANT = process.env.TENANT_ID ?? '11111111-1111-4111-8111-111111111111';

const envFile = readFileSync(resolve(root, '.env.auth.private'), 'utf8');
const env = (name) => {
  const line = envFile.split('\n').find((l) => l.startsWith(`${name}=`));
  if (line === undefined) throw new Error(`falta ${name} en .env.auth.private`);
  return line.slice(name.length + 1).trim();
};

async function call(method, path, body, token, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

const login = async (email, password) => {
  const res = await call('POST', '/v1/auth/login', { tenantId: TENANT, email, password });
  if (res.status !== 200) throw new Error(`no se pudo entrar como ${email} (${String(res.status)})`);
  return res.body.accessToken;
};

const minutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

const admin = await login(env('BOOTSTRAP_ADMIN_EMAIL'), env('BOOTSTRAP_ADMIN_PASSWORD'));

const PLAN = [
  {
    title: 'Relojes y objetos de escritorio',
    opens: -60,
    closes: 60 * 30,
    lots: [
      ['Reloj de bolsillo, plata, 1912', '180.00', '10.00', 14],
      ['Estilográfica de laca roja', '95.00', '5.00', 42],
      ['Tintero de cristal tallado', '40.00', '2.50', 60 * 3],
      ['Escritorio de nogal con tapa abatible', '650.00', '25.00', 60 * 26],
    ],
  },
  {
    title: 'Cartografía y grabados',
    opens: -30,
    closes: 60 * 8,
    lots: [
      ['Mapa de la costa cantábrica, 1789', '300.00', '15.00', 55],
      ['Grabado botánico, helechos', '70.00', '5.00', 95],
      ['Lote de cuatro postales de puerto', '25.00', '2.00', 2],
    ],
  },
  {
    title: 'Colección de otoño',
    opens: 60 * 20,
    closes: 60 * 72,
    lots: [['Juego de té de porcelana', '120.00', '10.00', 60 * 70]],
  },
];

const created = [];
for (const plan of PLAN) {
  const a = await call(
    'POST',
    '/v1/auctions',
    { title: plan.title, opensAt: minutes(plan.opens), closesAt: minutes(plan.closes) },
    admin,
  );
  if (a.status !== 201 && a.status !== 202) throw new Error(`subasta: ${String(a.status)}`);
  const auctionId = a.body.auctionId;
  // la subasta debe estar proyectada antes de añadirle lotes
  await new Promise((r) => setTimeout(r, 1500));
  for (const [title, start, inc, closesIn] of plan.lots) {
    const l = await call(
      'POST',
      `/v1/auctions/${auctionId}/lots`,
      { title, startingPrice: start, minIncrement: inc, currency: 'USD', closesAt: minutes(closesIn) },
      admin,
    );
    if (l.status !== 201 && l.status !== 202) throw new Error(`lote: ${String(l.status)}`);
    created.push({ lotId: l.body.lotId, start: Number(start), inc: Number(inc), open: plan.opens <= 0 });
  }
}

const stamp = randomBytes(2).toString('hex');
const bidders = [];
for (const base of ['Ana Torres', 'Ben Okafor', 'Clara M.', 'Diego Ruiz']) {
  const slug = base.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
  const password = randomBytes(18).toString('base64url');
  // si el nombre público ya existe (otra ejecución), se prueba con un sufijo
  for (let n = 1; n <= 5; n += 1) {
    const displayName = n === 1 ? base : `${base} ${String(n)}`;
    const email = `${slug}.${stamp}@demo.local`;
    const r = await call('POST', '/v1/auth/register', { tenantId: TENANT, email, password, displayName });
    if (r.status === 409) continue;
    if (r.status !== 201) throw new Error(`registro de ${displayName}: ${String(r.status)}`);
    bidders.push({ name: displayName, token: await login(email, password) });
    break;
  }
}

// Pujas: cada lote abierto recibe una escalera con postores que se alternan.
await new Promise((r) => setTimeout(r, 2000));
let bids = 0;
for (const lot of created.filter((l) => l.open)) {
  const rounds = 2 + Math.floor(Math.random() * 3);
  let price = lot.start;
  for (let i = 0; i < rounds && bidders.length > 0; i += 1) {
    price += lot.inc * (1 + Math.floor(Math.random() * 3));
    const bidder = bidders[(i + bids) % bidders.length];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const res = await call(
        'POST',
        `/v1/lots/${lot.lotId}/bids`,
        { amount: price.toFixed(2) },
        bidder.token,
        { 'idempotency-key': randomUUID() },
      );
      if (res.status === 202) {
        bids += 1;
        break;
      }
      if (res.status !== 404) break; // 404 = el lote aún no está proyectado
      await new Promise((r) => setTimeout(r, 750));
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}
console.log(
  `Sembrado: ${String(PLAN.length)} subastas, ${String(created.length)} lotes, ${String(bidders.length)} postores, ${String(bids)} pujas.`,
);

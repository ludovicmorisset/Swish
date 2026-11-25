import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash, pbkdf2 as pbkdf2Callback, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStore } from './src/domain.mjs';

const pbkdf2 = promisify(pbkdf2Callback);
const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(root);
const dataRoot = resolve(process.env.DATA_DIR || resolve(root, 'data'));
const registryPath = resolve(dataRoot, 'registry.json');
const sessions = new Map();
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const rateLimits = new Map();

await fs.mkdir(dataRoot, { recursive: true });

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, path);
}

async function getRegistry() {
  return readJson(registryPath, { users: [], clubs: [] });
}

function send(response, status, value, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(value));
}

async function body(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 6 * 1024 * 1024) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 });
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('JSON invalide.'), { status: 400 }); }
}

function allowRequest(request, response) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  let originUrl;
  try { originUrl = origin ? new URL(origin) : null; } catch { send(response, 403, { error: 'Origine refusée.' }); return false; }
  if (!host || originUrl && (originUrl.host !== host || originUrl.protocol !== 'https:' && originUrl.hostname !== 'localhost' && originUrl.hostname !== '127.0.0.1')) {
    send(response, 403, { error: 'Origine refusée.' });
    return false;
  }
  return true;
}

function limited(request, response) {
  const address = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = rateLimits.get(address) || { start: now, count: 0 };
  if (now - record.start > 60_000) { record.start = now; record.count = 0; }
  record.count += 1;
  rateLimits.set(address, record);
  if (record.count <= 30) return false;
  send(response, 429, { error: 'Trop de requêtes. Réessayez dans une minute.' });
  return true;
}

function cookie(token, maxAge = 60 * 60 * 24 * 14) {
  const secure = process.env.COOKIE_SECURE === 'false' ? '' : '; Secure';
  return `swish_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function sessionFor(request) {
  const token = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('swish_session='))?.slice('swish_session='.length);
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) { if (token) sessions.delete(token); return null; }
  return { ...session, token };
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = await pbkdf2(password, salt, 310_000, 32, 'sha256');
  return { salt, hash: hash.toString('hex') };
}

async function verifyPassword(password, credential) {
  const calculated = await hashPassword(password, credential.salt);
  const expected = Buffer.from(credential.hash, 'hex');
  const actual = Buffer.from(calculated.hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function handleApi(request, response, url) {
  if (!allowRequest(request, response)) return;
  if (limited(request, response)) return;
  const method = request.method;
  const path = url.pathname;
  if (method === 'GET' && path === '/api/health') return send(response, 200, { status: 'ok' });

  if (method === 'POST' && path === '/api/auth/register') {
    const input = await body(request);
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    const clubName = String(input.clubName || '').trim().slice(0, 80);
    if (!validEmail(email) || password.length < 12 || !clubName) return send(response, 400, { error: 'Indiquez le club, un courriel valide et un mot de passe de 12 caractères minimum.' });
    const registry = await getRegistry();
    if (registry.users.some(user => user.email === email)) return send(response, 409, { error: 'Ce courriel possède déjà un compte.' });
    const club = { id: randomUUID(), name: clubName, tagline: '', color: '#347a58', logo: null, createdAt: new Date().toISOString(), inviteHash: null };
    const user = { id: randomUUID(), email, clubId: club.id, role: 'owner', ...(await hashPassword(password)) };
    registry.clubs.push(club);
    registry.users.push(user);
    await writeJson(registryPath, registry);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, clubId: club.id, expiresAt: Date.now() + 14 * 86400_000 });
    return send(response, 201, { user: { email, role: user.role }, club: { id: club.id, name: club.name, tagline: club.tagline, color: club.color, logo: club.logo } }, { 'set-cookie': cookie(token) });
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const input = await body(request);
    const email = String(input.email || '').trim().toLowerCase();
    const registry = await getRegistry();
    const user = registry.users.find(item => item.email === email);
    if (!user || !await verifyPassword(String(input.password || ''), user)) return send(response, 401, { error: 'Courriel ou mot de passe incorrect.' });
    const club = registry.clubs.find(item => item.id === user.clubId);
    if (!club) return send(response, 401, { error: 'Espace club introuvable.' });
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, clubId: club.id, expiresAt: Date.now() + 14 * 86400_000 });
    return send(response, 200, { user: { email, role: user.role }, club: { id: club.id, name: club.name, tagline: club.tagline || '', color: club.color || '#347a58', logo: club.logo || null } }, { 'set-cookie': cookie(token) });
  }

  const session = sessionFor(request);
  const publicMatch = path.match(/^\/api\/public\/([A-Za-z0-9_-]{20,80})$/);
  if (method === 'GET' && publicMatch) {
    const registry = await getRegistry();
    const club = registry.clubs.find(item => item.publicToken === publicMatch[1] && item.publicExpiresAt > Date.now());
    if (!club) return send(response, 404, { error: 'Lien expiré ou invalide.' });
    const store = await readJson(resolve(dataRoot, `${club.id}.json`), { contests: [], activeContestId: null });
    const contest = store.contests.find(item => item.id === club.publicContestId) || store.contests.find(item => item.id === store.activeContestId) || store.contests[0];
    return send(response, 200, { clubName: club.name, contestName: contest ? `${contest.name} · ${contest.category || 'Open'}` : 'Aucun concours', players: (contest?.players || []).filter(player => player.status === 'completed').sort((a, b) => b.score - a.score || b.made - a.made || a.name.localeCompare(b.name)).map(player => ({ name: player.name, score: player.score, made: player.made })) });
  }

  if (method === 'POST' && path === '/api/auth/join') {
    const input = await body(request);
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    const registry = await getRegistry();
    const codeHash = createHash('sha256').update(String(input.inviteCode || '')).digest('hex');
    const club = registry.clubs.find(item => item.inviteHash && item.inviteExpiresAt > Date.now() && item.inviteHash === codeHash);
    if (!club) return send(response, 400, { error: 'Code d’invitation invalide ou expiré.' });
    if (!validEmail(email) || password.length < 12) return send(response, 400, { error: 'Courriel invalide ou mot de passe inférieur à 12 caractères.' });
    if (registry.users.some(user => user.email === email)) return send(response, 409, { error: 'Ce courriel possède déjà un compte.' });
    const user = { id: randomUUID(), email, clubId: club.id, role: 'member', ...(await hashPassword(password)) };
    registry.users.push(user);
    club.inviteHash = null;
    club.inviteExpiresAt = null;
    await writeJson(registryPath, registry);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, clubId: club.id, expiresAt: Date.now() + 14 * 86400_000 });
    return send(response, 201, { user: { email, role: user.role }, club: { id: club.id, name: club.name, tagline: club.tagline || '', color: club.color || '#347a58', logo: club.logo || null } }, { 'set-cookie': cookie(token) });
  }

  if (method === 'GET' && path === '/api/auth/me') {
    if (!session) return send(response, 401, { error: 'Connexion requise.' });
    const registry = await getRegistry();
    const user = registry.users.find(item => item.id === session.userId);
    const club = registry.clubs.find(item => item.id === session.clubId);
    return user && club ? send(response, 200, { user: { email: user.email, role: user.role }, club: { id: club.id, name: club.name, tagline: club.tagline || '', color: club.color || '#347a58', logo: club.logo || null } }) : send(response, 401, { error: 'Session invalide.' });
  }
  if (method === 'POST' && path === '/api/auth/logout') {
    if (session) sessions.delete(session.token);
    return send(response, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
  }
  if (!session) return send(response, 401, { error: 'Connectez-vous à l’espace de votre club pour synchroniser les données.' });

  if (method === 'GET' && path === '/api/store') {
    const store = await readJson(resolve(dataRoot, `${session.clubId}.json`), { contests: [], activeContestId: null });
    return send(response, 200, store);
  }
  if (method === 'PUT' && path === '/api/store') {
    const input = await body(request);
    try {
      const store = validateStore(input);
      await writeJson(resolve(dataRoot, `${session.clubId}.json`), store);
      const registry = await getRegistry();
      const club = registry.clubs.find(item => item.id === session.clubId);
      if (club?.publicToken) {
        const activeContest = store.contests.find(contest => contest.id === store.activeContestId);
        club.publicContestId = activeContest?.id || null;
        await writeJson(registryPath, registry);
      }
      return send(response, 200, { ok: true, savedAt: new Date().toISOString() });
    } catch (error) { return send(response, 400, { error: error.message || 'Données invalides.' }); }
  }
  if (method === 'PUT' && path === '/api/club/branding') {
    const input = await body(request);
    const registry = await getRegistry();
    const club = registry.clubs.find(item => item.id === session.clubId);
    const user = registry.users.find(item => item.id === session.userId);
    if (user?.role !== 'owner' || !club) return send(response, 403, { error: 'Réservé au responsable du club.' });
    const name = String(input.name || '').trim().slice(0, 60);
    const tagline = String(input.tagline || '').trim().slice(0, 100);
    const color = /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : '#347a58';
    const logo = typeof input.logo === 'string' && input.logo.startsWith('data:image/') && input.logo.length <= 700_000 ? input.logo : null;
    if (!name) return send(response, 400, { error: 'Le nom du club est obligatoire.' });
    Object.assign(club, { name, tagline, color, logo });
    await writeJson(registryPath, registry);
    return send(response, 200, { ok: true });
  }
  if (method === 'POST' && path === '/api/club/public-link') {
    const registry = await getRegistry();
    const user = registry.users.find(item => item.id === session.userId);
    const club = registry.clubs.find(item => item.id === session.clubId);
    if (user?.role !== 'owner' || !club) return send(response, 403, { error: 'Réservé au responsable du club.' });
    club.publicToken = randomBytes(24).toString('base64url');
    club.publicExpiresAt = Date.now() + 30 * 86400_000;
    const store = await readJson(resolve(dataRoot, `${club.id}.json`), { contests: [], activeContestId: null });
    club.publicContestId = store.activeContestId;
    await writeJson(registryPath, registry);
    return send(response, 201, { token: club.publicToken, expiresAt: new Date(club.publicExpiresAt).toISOString() });
  }
  if (method === 'POST' && path === '/api/club/invite') {
    const registry = await getRegistry();
    const club = registry.clubs.find(item => item.id === session.clubId);
    const user = registry.users.find(item => item.id === session.userId);
    if (user?.role !== 'owner' || !club) return send(response, 403, { error: 'Réservé au responsable du club.' });
    const code = randomBytes(18).toString('base64url');
    club.inviteHash = createHash('sha256').update(code).digest('hex');
    club.inviteExpiresAt = Date.now() + 7 * 86400_000;
    await writeJson(registryPath, registry);
    return send(response, 201, { code, expiresAt: new Date(club.inviteExpiresAt).toISOString() });
  }
  if (method === 'GET' && publicMatch) {
    const registry = await getRegistry();
    const club = registry.clubs.find(item => item.publicToken === publicMatch[1] && item.publicExpiresAt > Date.now());
    if (!club) return send(response, 404, { error: 'Lien expiré ou invalide.' });
    const store = await readJson(resolve(dataRoot, `${club.id}.json`), { contests: [], activeContestId: null });
    const contest = store.contests.find(item => item.id === club.publicContestId) || store.contests.find(item => item.id === store.activeContestId) || store.contests[0];
    return send(response, 200, { clubName: club.name, contestName: contest ? `${contest.name} · ${contest.category || 'Open'}` : 'Aucun concours', players: (contest?.players || []).filter(player => player.status === 'completed').sort((a, b) => b.score - a.score || b.made - a.made || a.name.localeCompare(b.name)).map(player => ({ name: player.name, score: player.score, made: player.made })) });
  }
  return send(response, 404, { error: 'Route inconnue.' });
}

const server = createServer(async (request, response) => {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  response.setHeader('x-frame-options', 'DENY');
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try { await handleApi(request, response, url); } catch (error) { send(response, error.status || 500, { error: error.status ? error.message : 'Erreur interne du serveur.' }); }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Méthode refusée.' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); } catch { response.writeHead(400); return response.end(); }
  if (!['/index.html', '/manifest.webmanifest', '/sw.js', '/public.html', '/privacy.html'].includes(pathname) && !pathname.startsWith('/src/')) { response.writeHead(404); return response.end('Not found'); }
  const file = resolve(publicRoot, `.${pathname}`);
  const allowedRoot = pathname.startsWith('/src/') ? resolve(publicRoot, 'src') + sep : publicRoot + sep;
  if (file !== publicRoot && !file.startsWith(allowedRoot)) { response.writeHead(403); return response.end(); }
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    response.writeHead(200, { 'content-type': mimeTypes[extname(file)] || 'application/octet-stream', 'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    if (request.method === 'HEAD') return response.end();
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404); response.end('Not found'); }
});

const port = Number(process.env.PORT || 8080);
server.listen(port, '0.0.0.0');

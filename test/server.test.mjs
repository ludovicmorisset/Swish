import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

async function startServer() {
  const dataDir = await mkdtemp(join(tmpdir(), 'swish-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, COOKIE_SECURE: 'false' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  return { base, child, dataDir };
}

function cookieFrom(response) {
  return response.headers.get('set-cookie').split(';')[0];
}

async function stopServer(server) {
  server.child.kill();
  await once(server.child, 'exit').catch(() => {});
  await rm(server.dataDir, { recursive: true, force: true });
}

test('club registration isolates stores, protects routes and shares only published scores', async t => {
  const server = await startServer();
  t.after(() => stopServer(server));
  const { base } = server;
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubName: 'Club Test', email: 'owner@example.test', password: 'very-secure-passphrase' })
  });
  assert.equal(register.status, 201);
  const ownerCookie = cookieFrom(register);
  const session = await register.json();
  assert.equal(session.user.role, 'owner');
  assert.equal((await fetch(`${base}/api/store`)).status, 401);

  const invite = await fetch(`${base}/api/club/invite`, { method: 'POST', headers: { cookie: ownerCookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(invite.status, 201);
  const { code } = await invite.json();
  const joined = await fetch(`${base}/api/auth/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inviteCode: code, email: 'member@example.test', password: 'another-secure-passphrase' }) });
  assert.equal(joined.status, 201);
  const memberCookie = cookieFrom(joined);

  const contest = { id: 'contest-1', name: 'Finale', category: 'U18', contestFormat: '5-racks-25-shots', duration: 60, remaining: 0, activeStation: 0, players: [{ id: 'player-1', name: 'Joueuse Test', status: 'completed', shots: Array(25).fill('pending').map((shot, index) => index === 4 ? 'made' : shot), score: 2, made: 1, finishedAt: new Date().toISOString() }], winnerId: 'player-1', tieBreakers: [] };
  const save = await fetch(`${base}/api/store`, { method: 'PUT', headers: { cookie: memberCookie, 'content-type': 'application/json' }, body: JSON.stringify({ contests: [contest], activeContestId: contest.id }) });
  assert.equal(save.status, 200);
  const publicLink = await fetch(`${base}/api/club/public-link`, { method: 'POST', headers: { cookie: ownerCookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(publicLink.status, 201);
  const { token } = await publicLink.json();
  const publicResult = await fetch(`${base}/api/public/${token}`);
  assert.equal(publicResult.status, 200);
  assert.equal((await publicResult.json()).players[0].name, 'Joueuse Test');

  const invalidData = await fetch(`${base}/api/store`, { method: 'PUT', headers: { cookie: memberCookie, 'content-type': 'application/json' }, body: JSON.stringify({ contests: [{ id: '../escape', name: 'Invalid', duration: 60, remaining: 0, activeStation: 0, players: [] }] }) });
  assert.equal(invalidData.status, 400);
  const memberBranding = await fetch(`${base}/api/club/branding`, { method: 'PUT', headers: { cookie: memberCookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Intrusion' }) });
  assert.equal(memberBranding.status, 403);
});

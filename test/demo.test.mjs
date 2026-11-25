import test from 'node:test';
import assert from 'node:assert/strict';
import { demoStore } from '../src/demo.mjs';
import { validateStore } from '../src/domain.mjs';

test('demo content is deterministic, fictitious and valid for the scoring domain', () => {
  const store = validateStore(demoStore('2026-01-01T12:00:00.000Z'));
  assert.equal(store.contests.length, 1);
  assert.equal(store.contests[0].category, 'Seniors · Mixte');
  assert.equal(store.contests[0].players.length, 4);
  assert.equal(store.contests[0].players.filter(player => player.status === 'completed').length, 3);
});

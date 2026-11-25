import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePlayers, rankPlayers, reorderPlayer, scoreShots, tiedLeaders, validateStore } from '../src/domain.mjs';

function contest(overrides = {}) {
  return {
    id: 'contest-1',
    name: 'Concours',
    duration: 60,
    remaining: 60,
    activeStation: 0,
    players: [],
    winnerId: null,
    ...overrides
  };
}

function player(id, name, shots, status = 'completed') {
  return { id, name, status, shots, score: 0, made: 0 };
}

test('scoreShots accounts for the two-point bonus ball at each rack', () => {
  const shots = Array(25).fill('pending');
  shots[4] = 'made';
  shots[5] = 'made';
  shots[24] = 'made';
  assert.equal(scoreShots(shots), 5);
});

test('rankPlayers uses points, made shots, then alphabetical order', () => {
  const players = [
    { id: 'z', name: 'Zoé', status: 'completed', score: 4, made: 3 },
    { id: 'b', name: 'Benoît', status: 'completed', score: 5, made: 2 },
    { id: 'a', name: 'Alice', status: 'completed', score: 5, made: 2 },
    { id: 'w', name: 'Waitlisted', status: 'waiting', score: 99, made: 25 }
  ];
  assert.deepEqual(rankPlayers(players).map(item => item.id), ['a', 'b', 'z']);
  assert.equal(comparePlayers(players[2], players[1]) < 0, true);
});

test('reorderPlayer only moves participants within list boundaries', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(reorderPlayer(players, 'b', -1), true);
  assert.deepEqual(players.map(item => item.id), ['b', 'a', 'c']);
  assert.equal(reorderPlayer(players, 'b', -1), false);
  assert.equal(reorderPlayer(players, 'missing', 1), false);
});

test('tiedLeaders returns all first-place players tied on points and made shots', () => {
  const players = [
    { id: 'a', name: 'Alice', status: 'completed', score: 8, made: 6 },
    { id: 'b', name: 'Benoît', status: 'completed', score: 8, made: 6 },
    { id: 'c', name: 'Camille', status: 'completed', score: 8, made: 5 }
  ];
  assert.deepEqual(tiedLeaders(players).map(item => item.id), ['a', 'b']);
});

test('validateStore validates structure and recalculates imported scores', () => {
  const shots = Array(25).fill('pending');
  shots[24] = 'made';
  const result = validateStore({ contests: [contest({ players: [player('p1', 'Camille', shots)] })], activeContestId: 'contest-1' });
  assert.equal(result.contests[0].players[0].score, 2);
  assert.equal(result.contests[0].players[0].made, 1);
  assert.deepEqual(result.contests[0].tieBreakers, []);
});

test('validateStore rejects corrupt records, invalid winners and invalid tie-break rounds', () => {
  assert.throws(() => validateStore({ contests: [{ ...contest(), players: [player('p', 'Test', ['made'])] }] }));
  assert.throws(() => validateStore({ contests: [contest({ winnerId: 'unknown' })] }));
  assert.throws(() => validateStore({ contests: [contest({ tieBreakers: [{ players: [{ id: 'p', name: 'Test', score: 40, made: 3 }] }] })] }));
});

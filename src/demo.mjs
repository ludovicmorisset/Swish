import { scoreShots } from './domain.mjs';

export function demoStore(now = new Date().toISOString()) {
  const makeShots = indexes => Array.from({ length: 25 }, (_, index) => indexes.includes(index) ? 'made' : 'missed');
  const players = [
    { id: 'demo-camille', name: 'Camille Martin', status: 'completed', shots: makeShots([0, 4, 7, 13, 24]), finishedAt: now },
    { id: 'demo-alexandre', name: 'Alexandre Durand', status: 'completed', shots: makeShots([1, 5, 9, 17]), finishedAt: now },
    { id: 'demo-noah', name: 'Noah Bernard', status: 'completed', shots: makeShots([4, 11, 20]), finishedAt: now },
    { id: 'demo-lea', name: 'Léa Tremblay', status: 'active', shots: Array(25).fill('pending'), finishedAt: null }
  ].map(player => ({ ...player, score: scoreShots(player.shots), made: player.shots.filter(shot => shot === 'made').length }));
  return {
    contests: [{ id: 'demo-club-contest', name: 'Trophée interclubs · Démonstration', category: 'Seniors · Mixte', contestFormat: '5-racks-25-shots', duration: 60, remaining: 60, activeStation: 2, players, winnerId: null, tieBreakers: [], createdAt: now }],
    activeContestId: 'demo-club-contest'
  };
}

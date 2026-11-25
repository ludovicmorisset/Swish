const SHOT_STATES = ['pending', 'made', 'missed'];
const PLAYER_STATUSES = ['waiting', 'active', 'completed'];

export function scoreShots(shots) {
  return shots.reduce((score, state, index) => score + (state === 'made' ? index % 5 === 4 ? 2 : 1 : 0), 0);
}

export function comparePlayers(a, b) {
  return b.score - a.score || b.made - a.made || a.name.localeCompare(b.name);
}

export function rankPlayers(players) {
  return [...players].filter(player => player.status === 'completed').sort(comparePlayers);
}

export function reorderPlayer(players, playerId, direction) {
  const index = players.findIndex(player => player.id === playerId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= players.length || ![-1, 1].includes(direction)) return false;
  [players[index], players[target]] = [players[target], players[index]];
  return true;
}

export function tiedLeaders(players) {
  const ranked = rankPlayers(players);
  if (ranked.length < 2) return [];
  return ranked.filter(player => player.score === ranked[0].score && player.made === ranked[0].made);
}

export function validateStore(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.contests) || value.contests.length > 100) {
    throw new Error('Format de sauvegarde invalide.');
  }
  const contestIds = new Set();
  const contests = value.contests.map(contest => {
    if (!contest || typeof contest !== 'object' || typeof contest.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(contest.id) || contestIds.has(contest.id) || typeof contest.name !== 'string' || !contest.name.trim() || !Array.isArray(contest.players) || contest.players.length > 500) {
      throw new Error('Un concours de la sauvegarde est invalide.');
    }
    contestIds.add(contest.id);
    const duration = Number(contest.duration);
    const remaining = Number(contest.remaining);
    const activeStation = Number(contest.activeStation);
    if (!Number.isInteger(duration) || duration < 10 || duration > 600 || !Number.isFinite(remaining) || remaining < 0 || remaining > duration || !Number.isInteger(activeStation) || activeStation < 0 || activeStation > 4) {
      throw new Error('Les réglages d’un concours sont invalides.');
    }
    const playerIds = new Set();
    const players = contest.players.map(player => {
      if (!player || typeof player !== 'object' || typeof player.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(player.id) || playerIds.has(player.id) || typeof player.name !== 'string' || !player.name.trim() || !PLAYER_STATUSES.includes(player.status) || !Array.isArray(player.shots) || player.shots.length !== 25 || player.shots.some(shot => !SHOT_STATES.includes(shot))) {
        throw new Error('Un participant de la sauvegarde est invalide.');
      }
      playerIds.add(player.id);
      return { ...player, name: player.name.trim().slice(0, 40), shots: [...player.shots], made: player.shots.filter(shot => shot === 'made').length, score: scoreShots(player.shots) };
    });
    if (players.filter(player => player.status === 'active').length > 1) {
      throw new Error('Un concours ne peut avoir qu’un participant actif.');
    }
    if (contest.winnerId != null && !players.some(player => player.id === contest.winnerId && player.status === 'completed')) {
      throw new Error('Le gagnant indiqué dans la sauvegarde est invalide.');
    }
    const tieBreakers = Array.isArray(contest.tieBreakers) ? contest.tieBreakers.map((round, index) => {
      if (!round || !Array.isArray(round.players) || round.players.length < 2 || round.players.some(player => !player || typeof player.id !== 'string' || !players.some(entrant => entrant.id === player.id) || typeof player.name !== 'string' || !Number.isInteger(player.score) || player.score < 0 || player.score > 30 || !Number.isInteger(player.made) || player.made < 0 || player.made > 25)) {
        throw new Error('Une manche de départage est invalide.');
      }
      return { round: Number.isInteger(round.round) && round.round > 0 ? round.round : index + 1, players: round.players.map(player => ({ ...player })) };
    }) : [];
    const category = typeof contest.category === 'string' ? contest.category.trim().slice(0, 40) : 'Open';
    const contestFormat = typeof contest.contestFormat === 'string' ? contest.contestFormat : '5-racks-25-shots';
    if (!['5-racks-25-shots', 'club-open', 'skills-challenge'].includes(contestFormat)) throw new Error('Le format de concours est invalide.');
    return { ...contest, name: contest.name.trim().slice(0, 60), category: category || 'Open', contestFormat, duration, remaining, activeStation, players, winnerId: contest.winnerId || null, tieBreakers };
  });
  const activeContestId = value.activeContestId == null ? null : value.activeContestId;
  if (activeContestId !== null && !contestIds.has(activeContestId)) {
    throw new Error('Le concours actif indiqué dans la sauvegarde est invalide.');
  }
  return { contests, activeContestId: activeContestId || contests[0]?.id || null };
}

const domain = { scoreShots, comparePlayers, rankPlayers, reorderPlayer, tiedLeaders, validateStore };
if (typeof window !== 'undefined') window.SwishDomain = domain;
if (typeof module !== 'undefined' && module.exports) module.exports = domain;
if (typeof globalThis !== 'undefined') globalThis.SwishDomain = domain;

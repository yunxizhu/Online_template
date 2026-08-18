'use strict';

const { io } = require('socket.io-client');

function once(socket, event, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + event)), timeout);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

(async () => {
  const a = io('http://localhost:3000', { transports: ['websocket'] });
  const b = io('http://localhost:3000', { transports: ['websocket'] });
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);

  a.emit('lobby:join', { playerName: 'Alice' });
  b.emit('lobby:join', { playerName: 'Bob' });
  await once(a, 'player:me');
  await once(b, 'player:me');

  const roomP = once(a, 'room:update');
  a.emit('room:create', { name: 'HiddenTest', hidden: true, maxPlayers: 2 });
  const created = await roomP;
  const roomId = created.room.id;
  console.log('created hidden room', roomId);

  const lobby = await new Promise((resolve) => {
    a.once('lobby:update', resolve);
    a.emit('lobby:join', { playerName: 'Alice' });
  });
  const inLobby = (lobby.rooms || []).some((r) => r.id === roomId);
  console.log('hidden room in lobby?', inLobby);
  if (inLobby) throw new Error('hidden room should not appear in lobby');

  const joinP = once(b, 'room:update');
  b.emit('room:join', { roomId });
  const joined = await joinP;
  console.log('bob joined, players', joined.room.players.length);

  const readyUpdates = Promise.all([once(a, 'room:update'), once(b, 'room:update')]);
  a.emit('room:ready', { ready: true });
  await readyUpdates;
  const ready2 = once(a, 'room:update');
  b.emit('room:ready', { ready: true });
  await ready2;

  const startedP = once(a, 'game:started');
  a.emit('room:start');
  const started = await startedP;
  console.log('game started, turn', started.state.turnNumber);

  const turnP = once(b, 'game:state');
  const current = started.state.currentPlayerId;
  const actor = current === a.id ? a : b;
  actor.emit('game:action', { type: 'end_turn' });
  const next = await turnP;
  console.log('next turn', next.state.turnNumber);

  a.close();
  b.close();
  console.log('SMOKE OK');
  process.exit(0);
})().catch((e) => {
  console.error('SMOKE FAIL', e);
  process.exit(1);
});

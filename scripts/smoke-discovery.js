'use strict';

const { io } = require('socket.io-client');

function once(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + event)), timeout);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function waitFor(socket, event, predicate, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, onData);
      reject(new Error('timeout wait ' + event));
    }, timeout);
    function onData(data) {
      if (predicate(data)) {
        clearTimeout(t);
        socket.off(event, onData);
        resolve(data);
      }
    }
    socket.on(event, onData);
  });
}

(async () => {
  const host = io('http://127.0.0.1:3000', { transports: ['websocket'] });
  const guestLocal = io('http://127.0.0.1:3001', { transports: ['websocket'] });

  await Promise.all([once(host, 'connect'), once(guestLocal, 'connect')]);

  host.emit('lobby:join', { playerName: 'HostPlayer' });
  guestLocal.emit('lobby:join', { playerName: 'GuestPlayer' });
  await once(host, 'player:me');
  await once(guestLocal, 'player:me');

  const createdP = once(host, 'room:update');
  host.emit('room:create', { name: 'LanRoom', hidden: false, maxPlayers: 2 });
  const created = await createdP;
  const roomId = created.room.id;
  console.log('host created', roomId);

  const found = await waitFor(
    guestLocal,
    'lobby:update',
    (data) => (data.rooms || []).some((r) => r.id === roomId && r.host)
  );
  const remote = found.rooms.find((r) => r.id === roomId);
  console.log('guest discovered room via', remote.host);

  guestLocal.close();

  const guestRemote = io(remote.host, { transports: ['websocket'] });
  await once(guestRemote, 'connect');
  guestRemote.emit('lobby:join', { playerName: 'GuestPlayer' });
  await once(guestRemote, 'player:me');

  const joinP = once(guestRemote, 'room:update');
  guestRemote.emit('room:join', { roomId });
  const joined = await joinP;
  console.log('joined players', joined.room.players.length);
  if (joined.room.players.length !== 2) throw new Error('expected 2 players');

  host.close();
  guestRemote.close();
  console.log('DISCOVERY SMOKE OK');
  process.exit(0);
})().catch((e) => {
  console.error('DISCOVERY SMOKE FAIL', e);
  process.exit(1);
});

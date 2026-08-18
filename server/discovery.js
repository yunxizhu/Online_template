'use strict';

const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');

const MULTICAST_ADDR = '239.255.90.91';
const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT) || 41234;
const BEACON_INTERVAL_MS = 1500;
const PEER_TTL_MS = 4500;

function listLanIPv4() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        ips.push(info.address);
      }
    }
  }
  return ips;
}

function pickPrimaryLanIP() {
  const ips = listLanIPv4();
  return ips[0] || '127.0.0.1';
}

/**
 * LAN presence + room advertisement over UDP multicast (with broadcast fallback).
 */
class LanDiscovery {
  constructor({ httpPort, getBeaconPayload, onChange, onRemoteInvite, instanceId }) {
    this.httpPort = httpPort;
    this.getBeaconPayload = getBeaconPayload;
    this.onChange = onChange || (() => {});
    this.onRemoteInvite = onRemoteInvite || (() => {});
    this.instanceId = instanceId || crypto.randomUUID();
    this.socket = null;
    this.timer = null;
    this.pruneTimer = null;
    /** 仅在有人进入大厅后才对外广播，避免空实例被发现 */
    this.advertising = false;
    /** @type {Map<string, object>} */
    this.peers = new Map();
    /** @type {Map<string, object>} 本机发出的跨实例邀请 */
    this.outboundInvites = new Map();
    /** @type {Set<string>} 已投递过的远端邀请，防重复弹窗 */
    this.seenInboundInvites = new Set();
  }

  start() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (err) => {
      console.error('[discovery]', err.message);
    });

    this.socket.on('message', (msg, rinfo) => {
      this.#handleMessage(msg, rinfo);
    });

    this.socket.bind(DISCOVERY_PORT, () => {
      try {
        this.socket.setBroadcast(true);
        this.socket.setMulticastTTL(1);
        this.socket.addMembership(MULTICAST_ADDR);
      } catch (err) {
        console.warn('[discovery] multicast setup:', err.message);
      }
      console.log(
        `[discovery] 局域网发现已监听 (UDP ${DISCOVERY_PORT}, 本机实例 ${this.instanceId.slice(0, 8)}…)`
      );
      this.timer = setInterval(() => this.broadcastNow(), BEACON_INTERVAL_MS);
      this.pruneTimer = setInterval(() => this.#prune(), 1000);
    });
  }

  setAdvertising(enabled) {
    const next = Boolean(enabled);
    if (this.advertising === next) {
      if (next) this.broadcastNow();
      return;
    }
    this.advertising = next;
    if (next) {
      console.log('[discovery] 开始对外广播（已有玩家进入大厅）');
      this.broadcastNow();
    } else {
      console.log('[discovery] 停止对外广播（大厅无人）');
      this.outboundInvites.clear();
    }
  }

  publishInvite(invite) {
    if (!invite || !invite.id) return;
    this.outboundInvites.set(invite.id, {
      ...invite,
      expires: invite.expires || Date.now() + 2 * 60 * 1000,
    });
    this.broadcastNow();
  }

  stop() {
    this.advertising = false;
    this.outboundInvites.clear();
    if (this.timer) clearInterval(this.timer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.socket) {
      try {
        this.socket.dropMembership(MULTICAST_ADDR);
      } catch (_) {
        /* ignore */
      }
      this.socket.close();
      this.socket = null;
    }
  }

  broadcastNow() {
    if (!this.socket || !this.advertising) return;
    this.#pruneOutboundInvites();

    const extra = this.getBeaconPayload() || {};
    const payload = {
      v: 1,
      type: 'beacon',
      lobby: true,
      instanceId: this.instanceId,
      port: this.httpPort,
      ips: listLanIPv4(),
      ts: Date.now(),
      ...extra,
      invites: [...this.outboundInvites.values()],
    };

    const buf = Buffer.from(JSON.stringify(payload), 'utf8');
    this.socket.send(buf, 0, buf.length, DISCOVERY_PORT, MULTICAST_ADDR);
    this.socket.send(buf, 0, buf.length, DISCOVERY_PORT, '255.255.255.255');
  }

  #pruneOutboundInvites() {
    const now = Date.now();
    for (const [id, inv] of this.outboundInvites) {
      if (!inv || inv.expires < now) this.outboundInvites.delete(id);
    }
  }

  #handleMessage(msg, rinfo) {
    let data;
    try {
      data = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (!data || data.v !== 1 || data.type !== 'beacon') return;
    if (data.instanceId === this.instanceId) return;
    // 忽略尚未进入大厅的实例广播（兼容旧包：无 lobby 字段则要求有 displayName）
    if (data.lobby !== true && !data.displayName) return;

    const port = Number(data.port) || this.httpPort;
    const ips = Array.isArray(data.ips) && data.ips.length ? data.ips : [rinfo.address];
    const hostIp = ips.find((ip) => ip && ip !== '127.0.0.1') || rinfo.address;
    const host = `http://${hostIp}:${port}`;

    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    const people = Array.isArray(data.people) ? data.people : [];
    this.peers.set(data.instanceId, {
      instanceId: data.instanceId,
      host,
      hostIp,
      port,
      displayName: data.displayName || '',
      rooms,
      people,
      lastSeen: Date.now(),
      via: 'lan',
    });

    if (Array.isArray(data.invites)) {
      for (const inv of data.invites) {
        if (!inv || inv.targetInstanceId !== this.instanceId) continue;
        if (!inv.id || this.seenInboundInvites.has(inv.id)) continue;
        this.seenInboundInvites.add(inv.id);
        this.onRemoteInvite({
          ...inv,
          host,
        });
      }
      if (this.seenInboundInvites.size > 200) {
        const keep = [...this.seenInboundInvites].slice(-80);
        this.seenInboundInvites = new Set(keep);
      }
    }

    this.onChange();
  }

  #prune() {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TTL_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  getOnlinePeers() {
    return [...this.peers.values()].map((p) => ({
      instanceId: p.instanceId,
      host: p.host,
      displayName: p.displayName,
      via: 'lan',
    }));
  }

  /** 其他已进大厅实例上的玩家 */
  getRemotePeople() {
    const list = [];
    for (const peer of this.peers.values()) {
      const people = Array.isArray(peer.people) ? peer.people : [];
      if (people.length) {
        for (const p of people) {
          list.push({
            ...p,
            id: `${peer.instanceId}:${p.id}`,
            socketId: p.id,
            instanceId: peer.instanceId,
            host: peer.host,
            local: false,
            via: 'lan',
          });
        }
      } else if (peer.displayName) {
        list.push({
          id: `${peer.instanceId}:host`,
          name: peer.displayName,
          status: 'idle',
          roomId: null,
          roomName: null,
          inviteOnly: false,
          instanceId: peer.instanceId,
          host: peer.host,
          local: false,
          via: 'lan',
        });
      }
    }
    return list;
  }

  /** Public waiting rooms from other instances (hidden excluded). */
  getPublicRooms() {
    const list = [];
    for (const peer of this.peers.values()) {
      for (const room of peer.rooms) {
        if (room.hidden) continue;
        if (room.status !== 'waiting') continue;
        list.push({
          ...room,
          host: peer.host,
          instanceId: peer.instanceId,
          local: false,
          via: 'lan',
        });
      }
    }
    return list;
  }

  /** Resolve room code against discovered peers (includes hidden). */
  resolveRoom(roomId) {
    const id = String(roomId || '').toUpperCase();
    if (!id) return null;
    for (const peer of this.peers.values()) {
      for (const room of peer.rooms) {
        if (room.id === id) {
          return { host: peer.host, room };
        }
      }
    }
    return null;
  }
}

module.exports = {
  LanDiscovery,
  listLanIPv4,
  pickPrimaryLanIP,
  DISCOVERY_PORT,
};

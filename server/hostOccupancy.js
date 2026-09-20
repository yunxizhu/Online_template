'use strict';

/**
 * 主机占用锁（已关闭）：允许多设备共用同一端口进大厅 / 开房。
 * 保留类接口，避免 index.js 大改；ENABLED=false 时不互斥、不记录占用者。
 * 若需恢复「同端口仅一人占用」，将 ENABLED 改为 true。
 */
const ENABLED = false;

class HostOccupancy {
  constructor({ onRelease } = {}) {
    /** @type {{ sessionId: string, socketId: string, name: string, tag: string }|null} */
    this.owner = null;
    this.onRelease = typeof onRelease === 'function' ? onRelease : null;
  }

  clear({ silent = false } = {}) {
    if (!ENABLED) {
      this.owner = null;
      return;
    }
    const had = Boolean(this.owner);
    this.owner = null;
    if (had && !silent && this.onRelease) {
      try {
        this.onRelease();
      } catch (_) {}
    }
  }

  #sessionKey(sessionId) {
    const sid = sessionId ? String(sessionId).slice(0, 64).trim() : '';
    return sid || null;
  }

  #normalizeTag(tag) {
    const digits = String(tag || '')
      .replace(/\D/g, '')
      .slice(-5);
    return digits ? digits.padStart(5, '0') : '';
  }

  #normalizeName(name) {
    return (
      String(name || '')
        .trim()
        .replace(/#\d{1,8}\s*$/, '')
        .trim()
        .slice(0, 16) || ''
    );
  }

  /** 展示用：昵称#尾缀；无昵称则退回短 sessionId */
  formatWho(snap) {
    const o = snap || this.owner;
    if (!o) return '';
    const name = this.#normalizeName(o.name);
    const tag = this.#normalizeTag(o.tag);
    if (name && tag) return `${name}#${tag}`;
    if (name) return name;
    if (tag) return `#${tag}`;
    const sid = String(o.sessionId || '');
    if (sid.startsWith('sock:')) return sid.slice(0, 12);
    return sid ? sid.slice(0, 8) : '';
  }

  getSnapshot() {
    if (!ENABLED || !this.owner) return null;
    return {
      sessionId: this.owner.sessionId,
      socketId: this.owner.socketId,
      name: this.owner.name || '',
      tag: this.owner.tag || '',
      who: this.formatWho(this.owner),
    };
  }

  isOwner(sessionId, socketId) {
    if (!ENABLED) return false;
    if (!this.owner) return false;
    const sid = this.#sessionKey(sessionId);
    if (sid && this.owner.sessionId === sid) return true;
    if (socketId && this.owner.socketId === socketId) return true;
    return false;
  }

  /** 是否已被他人占用（关闭占用锁时永不拦截） */
  isBlockedFor(sessionId, socketId) {
    if (!ENABLED) return false;
    if (!this.owner) return false;
    return !this.isOwner(sessionId, socketId);
  }

  /**
   * 认领或续占。已有他人占用时返回 false（force 时强制接管）。
   */
  claim(sessionId, socketId, { force = false, name, tag } = {}) {
    if (!ENABLED) return true;
    const sid = this.#sessionKey(sessionId) || `sock:${socketId}`;
    if (!force && this.owner && !this.isOwner(sessionId, socketId)) {
      return false;
    }
    const prev = this.owner;
    const nextName = this.#normalizeName(name);
    const nextTag = this.#normalizeTag(tag);
    this.owner = {
      sessionId: sid,
      socketId: String(socketId || ''),
      name: nextName || (prev && prev.name) || '',
      tag: nextTag || (prev && prev.tag) || '',
    };
    return true;
  }

  /**
   * 占用者连接断开：有同 session 存活连接则转移，否则立即释放。
   * @returns {'transferred'|'released'|'noop'}
   */
  transferOrRelease(sessionId, nextSocketId, meta = {}) {
    if (!ENABLED) return 'noop';
    if (!this.owner) return 'noop';
    if (nextSocketId) {
      this.claim(sessionId, nextSocketId, {
        name: meta.name,
        tag: meta.tag,
      });
      return 'transferred';
    }
    this.clear();
    return 'released';
  }

  /**
   * roomId 指向本机已有房间 → 进房通行，不抢占占用权。
   */
  isJoinTransit(roomId, roomManager) {
    const id = String(roomId || '')
      .trim()
      .toUpperCase();
    if (!id || !roomManager || typeof roomManager.getRoom !== 'function') {
      return false;
    }
    return Boolean(roomManager.getRoom(id));
  }
}

module.exports = {
  HostOccupancy,
  /** @deprecated 仅供调试；改 ENABLED 常量以开关 */
  HOST_OCCUPANCY_ENABLED: ENABLED,
};

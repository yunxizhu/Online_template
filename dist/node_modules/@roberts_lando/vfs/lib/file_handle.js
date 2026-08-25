'use strict';

const { Buffer } = require('node:buffer');
const {
  createEBADF,
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_INVALID_STATE,
} = require('./errors.js');

const kPath = Symbol('kPath');
const kFlags = Symbol('kFlags');
const kMode = Symbol('kMode');
const kPosition = Symbol('kPosition');
const kClosed = Symbol('kClosed');

class VirtualFileHandle {
  constructor(path, flags, mode) {
    this[kPath] = path;
    this[kFlags] = flags;
    this[kMode] = mode ?? 0o644;
    this[kPosition] = 0;
    this[kClosed] = false;
  }

  get path() {
    return this[kPath];
  }

  get flags() {
    return this[kFlags];
  }

  get mode() {
    return this[kMode];
  }

  get position() {
    return this[kPosition];
  }

  set position(pos) {
    this[kPosition] = pos;
  }

  get closed() {
    return this[kClosed];
  }

  #checkClosed() {
    if (this[kClosed]) {
      throw createEBADF('read');
    }
  }

  async read(buffer, offset, length, position) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('read');
  }

  readSync(buffer, offset, length, position) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('readSync');
  }

  async write(buffer, offset, length, position) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('write');
  }

  writeSync(buffer, offset, length, position) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('writeSync');
  }

  async readFile(options) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('readFile');
  }

  readFileSync(options) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('readFileSync');
  }

  async writeFile(data, options) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('writeFile');
  }

  writeFileSync(data, options) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('writeFileSync');
  }

  async stat(options) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('stat');
  }

  statSync(options) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('statSync');
  }

  async truncate(len) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('truncate');
  }

  truncateSync(len) {
    this.#checkClosed();
    throw new ERR_METHOD_NOT_IMPLEMENTED('truncateSync');
  }

  async close() {
    this[kClosed] = true;
  }

  closeSync() {
    this[kClosed] = true;
  }
}

class MemoryFileHandle extends VirtualFileHandle {
  #content;
  #entry;
  #getStats;

  #checkClosed() {
    if (this.closed) {
      throw createEBADF('read');
    }
  }

  constructor(path, flags, mode, content, entry, getStats) {
    super(path, flags, mode);
    this.#content = content;
    this.#entry = entry;
    this.#getStats = getStats;

    if (flags === 'w' || flags === 'w+') {
      this.#content = Buffer.alloc(0);
      if (entry) {
        entry.content = this.#content;
      }
    } else if (flags === 'a' || flags === 'a+') {
      this.position = this.#content.length;
    }
  }

  get content() {
    if (this.#entry?.isDynamic && this.#entry.isDynamic()) {
      return this.#entry.getContentSync();
    }
    return this.#content;
  }

  async getContentAsync() {
    if (this.#entry?.getContentAsync) {
      return this.#entry.getContentAsync();
    }
    return this.#content;
  }

  readSync(buffer, offset, length, position) {
    this.#checkClosed();

    const content = this.content;
    const readPos = position !== null && position !== undefined ? position : this.position;
    const available = content.length - readPos;

    if (available <= 0) {
      return 0;
    }

    const bytesToRead = Math.min(length, available);
    content.copy(buffer, offset, readPos, readPos + bytesToRead);

    if (position === null || position === undefined) {
      this.position = readPos + bytesToRead;
    }

    return bytesToRead;
  }

  async read(buffer, offset, length, position) {
    const bytesRead = this.readSync(buffer, offset, length, position);
    return { bytesRead, buffer };
  }

  writeSync(buffer, offset, length, position) {
    this.#checkClosed();

    const writePos = position !== null && position !== undefined ? position : this.position;
    const data = buffer.subarray(offset, offset + length);

    if (writePos + length > this.#content.length) {
      const newContent = Buffer.alloc(writePos + length);
      this.#content.copy(newContent, 0, 0, this.#content.length);
      this.#content = newContent;
    }

    data.copy(this.#content, writePos);

    if (this.#entry) {
      this.#entry.content = this.#content;
      this.#entry.mtime = Date.now();
    }

    if (position === null || position === undefined) {
      this.position = writePos + length;
    }

    return length;
  }

  async write(buffer, offset, length, position) {
    const bytesWritten = this.writeSync(buffer, offset, length, position);
    return { bytesWritten, buffer };
  }

  readFileSync(options) {
    this.#checkClosed();

    const content = this.content;
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (encoding) {
      return content.toString(encoding);
    }
    return Buffer.from(content);
  }

  async readFile(options) {
    this.#checkClosed();

    const content = await this.getContentAsync();
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (encoding) {
      return content.toString(encoding);
    }
    return Buffer.from(content);
  }

  writeFileSync(data, options) {
    this.#checkClosed();

    const buffer = typeof data === 'string' ? Buffer.from(data, options?.encoding) : data;

    if (this.flags === 'a' || this.flags === 'a+') {
      const newContent = Buffer.alloc(this.#content.length + buffer.length);
      this.#content.copy(newContent, 0);
      buffer.copy(newContent, this.#content.length);
      this.#content = newContent;
    } else {
      this.#content = Buffer.from(buffer);
    }

    if (this.#entry) {
      this.#entry.content = this.#content;
      this.#entry.mtime = Date.now();
    }

    this.position = this.#content.length;
  }

  async writeFile(data, options) {
    this.writeFileSync(data, options);
  }

  statSync(options) {
    this.#checkClosed();
    if (this.#getStats) {
      return this.#getStats(this.#content.length);
    }
    throw new ERR_INVALID_STATE('stats not available');
  }

  async stat(options) {
    return this.statSync(options);
  }

  truncateSync(len = 0) {
    this.#checkClosed();

    if (len < this.#content.length) {
      this.#content = this.#content.subarray(0, len);
    } else if (len > this.#content.length) {
      const newContent = Buffer.alloc(len);
      this.#content.copy(newContent, 0, 0, this.#content.length);
      this.#content = newContent;
    }

    if (this.#entry) {
      this.#entry.content = this.#content;
      this.#entry.mtime = Date.now();
    }
  }

  async truncate(len) {
    this.truncateSync(len);
  }
}

module.exports = {
  VirtualFileHandle,
  MemoryFileHandle,
};

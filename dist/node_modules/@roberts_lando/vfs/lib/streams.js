'use strict';

const { Readable } = require('node:stream');
const { createEBADF } = require('./errors.js');
const { getVirtualFd } = require('./fd.js');

class VirtualReadStream extends Readable {
  #vfs;
  #path;
  #fd = null;
  #end;
  #pos;
  #content = null;
  #destroyed = false;
  #autoClose;

  constructor(vfs, filePath, options = {}) {
    const {
      start = 0,
      end = Infinity,
      highWaterMark = 64 * 1024,
      encoding,
      ...streamOptions
    } = options;

    super({ ...streamOptions, highWaterMark, encoding });

    this.#vfs = vfs;
    this.#path = filePath;
    this.#end = end;
    this.#pos = start;
    this.#autoClose = options.autoClose !== false;

    process.nextTick(() => this.#openFile());
  }

  get path() {
    return this.#path;
  }

  #openFile() {
    try {
      this.#fd = this.#vfs.openSync(this.#path);
      this.emit('open', this.#fd);
      this.emit('ready');
    } catch (err) {
      this.destroy(err);
    }
  }

  _read(size) {
    if (this.#destroyed || this.#fd === null) {
      return;
    }

    if (this.#content === null) {
      try {
        const vfd = getVirtualFd(this.#fd);
        if (!vfd) {
          this.destroy(createEBADF('read'));
          return;
        }
        this.#content = vfd.entry.readFileSync();
      } catch (err) {
        this.destroy(err);
        return;
      }
    }

    const endPos = this.#end === Infinity ? this.#content.length : this.#end + 1;
    const remaining = Math.min(endPos, this.#content.length) - this.#pos;
    if (remaining <= 0) {
      this.push(null);
      return;
    }

    const bytesToRead = Math.min(size, remaining);
    const chunk = this.#content.subarray(this.#pos, this.#pos + bytesToRead);
    this.#pos += bytesToRead;

    this.push(chunk);

    if (this.#pos >= endPos || this.#pos >= this.#content.length) {
      this.push(null);
    }
  }

  #close() {
    if (this.#fd !== null) {
      try {
        this.#vfs.closeSync(this.#fd);
      } catch {
        // Ignore close errors
      }
      this.#fd = null;
    }
  }

  _destroy(err, callback) {
    this.#destroyed = true;
    if (this.#autoClose) {
      this.#close();
    }
    callback(err);
  }
}

module.exports = {
  VirtualReadStream,
};

'use strict';

const {
  ERR_METHOD_NOT_IMPLEMENTED,
  createEROFS,
} = require('./errors.js');

class VirtualProvider {
  get readonly() {
    return false;
  }

  get supportsSymlinks() {
    return false;
  }

  get supportsWatch() {
    return false;
  }

  // === ESSENTIAL PRIMITIVES ===

  async open(path, flags, mode) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('open');
  }

  openSync(path, flags, mode) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('openSync');
  }

  async stat(path, options) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('stat');
  }

  statSync(path, options) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('statSync');
  }

  async lstat(path, options) {
    return this.stat(path, options);
  }

  lstatSync(path, options) {
    return this.statSync(path, options);
  }

  async readdir(path, options) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('readdir');
  }

  readdirSync(path, options) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('readdirSync');
  }

  async mkdir(path, options) {
    if (this.readonly) {
      throw createEROFS('mkdir', path);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('mkdir');
  }

  mkdirSync(path, options) {
    if (this.readonly) {
      throw createEROFS('mkdir', path);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('mkdirSync');
  }

  async rmdir(path) {
    if (this.readonly) {
      throw createEROFS('rmdir', path);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('rmdir');
  }

  rmdirSync(path) {
    if (this.readonly) {
      throw createEROFS('rmdir', path);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('rmdirSync');
  }

  async unlink(path) {
    if (this.readonly) {
      throw createEROFS('unlink', path);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('unlink');
  }

  unlinkSync(path) {
    if (this.readonly) {
      throw createEROFS('unlink', path);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('unlinkSync');
  }

  async rename(oldPath, newPath) {
    if (this.readonly) {
      throw createEROFS('rename', oldPath);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('rename');
  }

  renameSync(oldPath, newPath) {
    if (this.readonly) {
      throw createEROFS('rename', oldPath);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('renameSync');
  }

  // === DEFAULT IMPLEMENTATIONS ===

  async readFile(path, options) {
    const handle = await this.open(path, 'r');
    try {
      return await handle.readFile(options);
    } finally {
      await handle.close();
    }
  }

  readFileSync(path, options) {
    const handle = this.openSync(path, 'r');
    try {
      return handle.readFileSync(options);
    } finally {
      handle.closeSync();
    }
  }

  async writeFile(path, data, options) {
    if (this.readonly) {
      throw createEROFS('open', path);
    }
    const handle = await this.open(path, 'w', options?.mode);
    try {
      await handle.writeFile(data, options);
    } finally {
      await handle.close();
    }
  }

  writeFileSync(path, data, options) {
    if (this.readonly) {
      throw createEROFS('open', path);
    }
    const handle = this.openSync(path, 'w', options?.mode);
    try {
      handle.writeFileSync(data, options);
    } finally {
      handle.closeSync();
    }
  }

  async appendFile(path, data, options) {
    if (this.readonly) {
      throw createEROFS('open', path);
    }
    const handle = await this.open(path, 'a', options?.mode);
    try {
      await handle.writeFile(data, options);
    } finally {
      await handle.close();
    }
  }

  appendFileSync(path, data, options) {
    if (this.readonly) {
      throw createEROFS('open', path);
    }
    const handle = this.openSync(path, 'a', options?.mode);
    try {
      handle.writeFileSync(data, options);
    } finally {
      handle.closeSync();
    }
  }

  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  existsSync(path) {
    try {
      this.statSync(path);
      return true;
    } catch {
      return false;
    }
  }

  async copyFile(src, dest, mode) {
    if (this.readonly) {
      throw createEROFS('copyfile', dest);
    }
    const content = await this.readFile(src);
    await this.writeFile(dest, content);
  }

  copyFileSync(src, dest, mode) {
    if (this.readonly) {
      throw createEROFS('copyfile', dest);
    }
    const content = this.readFileSync(src);
    this.writeFileSync(dest, content);
  }

  internalModuleStat(path) {
    try {
      const stats = this.statSync(path);
      if (stats.isDirectory()) {
        return 1;
      }
      return 0;
    } catch {
      return -2;
    }
  }

  async realpath(path, options) {
    await this.stat(path);
    return path;
  }

  realpathSync(path, options) {
    this.statSync(path);
    return path;
  }

  async access(path, mode) {
    await this.stat(path);
  }

  accessSync(path, mode) {
    this.statSync(path);
  }

  // === SYMLINK OPERATIONS ===

  async readlink(path, options) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('readlink');
  }

  readlinkSync(path, options) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('readlinkSync');
  }

  async symlink(target, path, type) {
    if (this.readonly) {
      throw createEROFS('symlink', path);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('symlink');
  }

  symlinkSync(target, path, type) {
    if (this.readonly) {
      throw createEROFS('symlink', path);
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED('symlinkSync');
  }

  // === WATCH OPERATIONS ===

  watch(path, options) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('watch');
  }

  watchAsync(path, options) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('watchAsync');
  }

  watchFile(path, options) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('watchFile');
  }

  unwatchFile(path, listener) {
    throw new ERR_METHOD_NOT_IMPLEMENTED('unwatchFile');
  }
}

module.exports = {
  VirtualProvider,
};

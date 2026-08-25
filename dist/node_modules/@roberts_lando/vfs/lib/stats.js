'use strict';

// File type constants from POSIX
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

const kDefaultBlockSize = 4096;

class VirtualStats {
  constructor(props) {
    this.dev = props.dev ?? 0;
    this.mode = props.mode;
    this.nlink = props.nlink ?? 1;
    this.uid = props.uid ?? (process.getuid?.() ?? 0);
    this.gid = props.gid ?? (process.getgid?.() ?? 0);
    this.rdev = props.rdev ?? 0;
    this.blksize = props.blksize ?? kDefaultBlockSize;
    this.ino = props.ino ?? 0;
    this.size = props.size;
    this.blocks = props.blocks ?? Math.ceil(props.size / 512);

    this.atimeMs = props.atimeMs;
    this.mtimeMs = props.mtimeMs;
    this.ctimeMs = props.ctimeMs;
    this.birthtimeMs = props.birthtimeMs;

    this.atime = new Date(this.atimeMs);
    this.mtime = new Date(this.mtimeMs);
    this.ctime = new Date(this.ctimeMs);
    this.birthtime = new Date(this.birthtimeMs);
  }

  isFile() {
    return (this.mode & S_IFMT) === S_IFREG;
  }

  isDirectory() {
    return (this.mode & S_IFMT) === S_IFDIR;
  }

  isSymbolicLink() {
    return (this.mode & S_IFMT) === S_IFLNK;
  }

  isBlockDevice() {
    return false;
  }

  isCharacterDevice() {
    return false;
  }

  isFIFO() {
    return false;
  }

  isSocket() {
    return false;
  }
}

function createFileStats(size, options = {}) {
  const now = Date.now();
  return new VirtualStats({
    mode: (options.mode ?? 0o644) | S_IFREG,
    size,
    atimeMs: options.atimeMs ?? now,
    mtimeMs: options.mtimeMs ?? now,
    ctimeMs: options.ctimeMs ?? now,
    birthtimeMs: options.birthtimeMs ?? now,
  });
}

function createDirectoryStats(options = {}) {
  const now = Date.now();
  return new VirtualStats({
    mode: (options.mode ?? 0o755) | S_IFDIR,
    size: kDefaultBlockSize,
    blocks: 8,
    atimeMs: options.atimeMs ?? now,
    mtimeMs: options.mtimeMs ?? now,
    ctimeMs: options.ctimeMs ?? now,
    birthtimeMs: options.birthtimeMs ?? now,
  });
}

function createSymlinkStats(size, options = {}) {
  const now = Date.now();
  return new VirtualStats({
    mode: (options.mode ?? 0o777) | S_IFLNK,
    size,
    atimeMs: options.atimeMs ?? now,
    mtimeMs: options.mtimeMs ?? now,
    ctimeMs: options.ctimeMs ?? now,
    birthtimeMs: options.birthtimeMs ?? now,
  });
}

module.exports = {
  VirtualStats,
  createFileStats,
  createDirectoryStats,
  createSymlinkStats,
  S_IFMT,
  S_IFREG,
  S_IFDIR,
  S_IFLNK,
};

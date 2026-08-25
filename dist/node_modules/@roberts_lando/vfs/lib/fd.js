'use strict';

const kFd = Symbol('kFd');
const kEntry = Symbol('kEntry');

// FD range: 10000+ to avoid conflicts with real fds
let nextFd = 10_000;

const openFDs = new Map();

class VirtualFD {
  constructor(fd, entry) {
    this[kFd] = fd;
    this[kEntry] = entry;
  }

  get fd() {
    return this[kFd];
  }

  get entry() {
    return this[kEntry];
  }
}

function openVirtualFd(entry) {
  const fd = nextFd++;
  const vfd = new VirtualFD(fd, entry);
  openFDs.set(fd, vfd);
  return fd;
}

function getVirtualFd(fd) {
  return openFDs.get(fd);
}

function closeVirtualFd(fd) {
  return openFDs.delete(fd);
}

module.exports = {
  VirtualFD,
  openVirtualFd,
  getVirtualFd,
  closeVirtualFd,
};

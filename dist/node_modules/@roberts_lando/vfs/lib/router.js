'use strict';

const { isAbsolute, posix: pathPosix } = require('node:path');

function splitPath(normalizedPath) {
  if (normalizedPath === '/') {
    return [];
  }
  return normalizedPath.slice(1).split('/');
}

function getParentPath(normalizedPath) {
  if (normalizedPath === '/') {
    return null;
  }
  return pathPosix.dirname(normalizedPath);
}

function getBaseName(normalizedPath) {
  return pathPosix.basename(normalizedPath);
}

function isUnderMountPoint(normalizedPath, mountPoint) {
  if (normalizedPath === mountPoint) {
    return true;
  }
  if (mountPoint === '/') {
    return normalizedPath.startsWith('/');
  }
  return normalizedPath.startsWith(mountPoint + '/');
}

function getRelativePath(normalizedPath, mountPoint) {
  if (normalizedPath === mountPoint) {
    return '/';
  }
  if (mountPoint === '/') {
    return normalizedPath;
  }
  return normalizedPath.slice(mountPoint.length);
}

module.exports = {
  splitPath,
  getParentPath,
  getBaseName,
  isUnderMountPoint,
  getRelativePath,
  isAbsolutePath: isAbsolute,
};

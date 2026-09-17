'use strict';

const SUITS = ['spade', 'heart', 'club', 'diamond'];
const SUIT_LABEL = {
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
};
const SUIT_COLOR = {
  spade: 'black',
  heart: 'red',
  club: 'black',
  diamond: 'red',
};

const IDENTITY = {
  zhu: '主公',
  zhong: '忠臣',
  fan: '反贼',
  nei: '内奸',
  xianzhu: '先主',
  houzhu: '后主',
  huangjin: '黄巾',
};

/** @param {5|8} n */
function identityDeck(n) {
  if (n === 5) return ['zhu', 'zhong', 'fan', 'fan', 'nei'];
  if (n === 8) return ['zhu', 'zhong', 'zhong', 'fan', 'fan', 'fan', 'fan', 'nei'];
  throw new Error('标准身份仅支持 5 或 8 人');
}

/** 先主模式身份牌 @param {5|8} n */
function xianzhuIdentityDeck(n) {
  if (n === 5) return ['xianzhu', 'zhong', 'huangjin', 'fan', 'fan'];
  if (n === 8) {
    return [
      'xianzhu',
      'zhong',
      'zhong',
      'huangjin',
      'fan',
      'fan',
      'fan',
      'fan',
    ];
  }
  throw new Error('先主模式仅支持 5 或 8 人');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _uid = 1;
function uid(prefix) {
  _uid += 1;
  return `${prefix}_${_uid}`;
}

module.exports = {
  SUITS,
  SUIT_LABEL,
  SUIT_COLOR,
  IDENTITY,
  identityDeck,
  xianzhuIdentityDeck,
  shuffle,
  uid,
};

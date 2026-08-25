'use strict';
module.exports = {
  id: 'handang',
  name: '韩当',
  title: '弓骑营督',
  country: '吴',
  maxHp: 4,
  gender: 'male',
  portrait: 'hero_handang.png',
  skills: [
    require('./gongqi'),
    require('./jiefan'),
  ],
};

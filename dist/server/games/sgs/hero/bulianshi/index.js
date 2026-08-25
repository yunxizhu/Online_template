'use strict';
module.exports = {
  id: 'bulianshi',
  name: '步练师',
  title: '无冕之后',
  country: '吴',
  maxHp: 3,
  gender: 'female',
  portrait: 'hero_bulianshi.png',
  skills: [
    require('./anxu'),
    require('./zhuiyi'),
  ],
};

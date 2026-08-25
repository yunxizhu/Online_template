'use strict';
module.exports = {
  id: 'yangxiu',
  name: '杨修',
  code: 'SP003',
  title: '恃才放旷',
  country: '魏',
  maxHp: 3,
  gender: 'male',
  portrait: 'hero_yangxiu.png',
  skills: [
    require('./jilei'),
    require('./danlao'),
  ],
};

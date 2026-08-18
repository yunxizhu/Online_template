'use strict';
module.exports = {
  id: 'dengai',
  name: '邓艾',
  title: '矫然的壮士',
  country: '魏',
  maxHp: 4,
  gender: 'male',
  portrait: 'hero_dengai.png',
  skills: [
    require('./tuntian'),
    require('./zaiqi'),
    require('./jixi'),
  ],
};

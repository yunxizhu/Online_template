const fs = require('fs');
const keys = {
  zh: {
    discardBuilding: '弃置腾格',
    discardBuildingHint: '主动弃掉该格建筑，腾出格子给新建筑',
    confirmDiscardBuilding: '确定弃置「{label}」？建筑入弃牌堆，格子将空出。',
    confirmReplaceBuilding:
      '格子 {slot} 已有「{oldLabel}」。弃置它并将「{newLabel}」放到该格？',
    placeSlotPrompt: '放置到格子 1-6，或 none（无数字格）',
    slotInvalid: '格子无效，请输入 1-6 或 none',
  },
  en: {
    discardBuilding: 'Discard',
    discardBuildingHint: 'Discard this building to free its slot',
    confirmDiscardBuilding:
      'Discard “{label}”? It goes to the discard pile and frees the slot.',
    confirmReplaceBuilding:
      'Slot {slot} has “{oldLabel}”. Discard it and place “{newLabel}” there?',
    placeSlotPrompt: 'Place on slot 1-6, or none',
    slotInvalid: 'Invalid slot — use 1-6 or none',
  },
};
for (const [lang, msgs] of Object.entries(keys)) {
  const f = `public/i18n/${lang}.json`;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  Object.assign(j.lasidao, msgs);
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
console.log('i18n ok');

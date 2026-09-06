// quick test
let t = (k, v) => k; 
const title = { id: 'boostedTycoon', need: 3, score: 2 };
const lines = [];
if (!title) return;
const need = title.need || 3;
const score = title.score || 2;
lines.push(t('title', { need, score }));
console.log(lines);

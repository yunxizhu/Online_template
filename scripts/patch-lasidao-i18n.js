'use strict';
const fs = require('fs');
const f = 'public/games/lasidao/ui.js';
let s = fs.readFileSync(f, 'utf8');

const helper = `window.LasidaoUi = (function () {
  function $(id) {
    return document.getElementById(id);
  }

  function t(key, vars) {
    return window.I18n && typeof window.I18n.t === 'function'
      ? window.I18n.t(key, vars)
      : key;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function phaseLabel(phase) {
    const k = 'lasidao.phase.' + phase;
    const v = t(k);
    return v === k ? phase : v;
  }

  function areaLabel(area) {
    const k = 'lasidao.area.' + area;
    const v = t(k);
    return v === k ? area : v;
  }

  const PHASE_LABEL = new Proxy(
    {},
    { get: (_, p) => phaseLabel(p) }
  );

  const AREA_LABEL = new Proxy(
    {},
    { get: (_, p) => areaLabel(p) }
  );
`;

s = s.replace(
  /window\.LasidaoUi = \(function \(\) \{\s*function \$\(id\) \{\s*return document\.getElementById\(id\);\s*\}\s*function escapeHtml\(s\) \{[\s\S]*?const PHASE_LABEL = \{[\s\S]*?\};\s*const AREA_LABEL = \{[\s\S]*?\};/,
  helper
);

// You mark
s = s.replace(
  "(isMe ? ' <span class=\"you\">(?)</span>' : '')",
  "(isMe ? ' <span class=\"you\">(' + t('lasidao.youMark') + ')</span>' : '')"
);

// Round line - find las-round assignment
s = s.replace(
  /\$\('las-round'\)\.textContent =\s*'[^']*'\s*\+\s*game\.round\s*\+\s*'[^']*'\s*\+\s*\(PHASE_LABEL\[game\.phase\] \|\| game\.phase\);/,
  "$('las-round').textContent = t('lasidao.roundPhase', {\n      round: game.round,\n      phase: phaseLabel(game.phase),\n    });"
);

// Deck meta if we have individual elements - panel now has las-deck-meta
if (!s.includes("las-deck-meta")) {
  // inject after round
  s = s.replace(
    "$('las-round').textContent = t('lasidao.roundPhase', {\n      round: game.round,\n      phase: phaseLabel(game.phase),\n    });",
    `$('las-round').textContent = t('lasidao.roundPhase', {
      round: game.round,
      phase: phaseLabel(game.phase),
    });
    const deckMeta = $('las-deck-meta');
    if (deckMeta) {
      deckMeta.textContent = t('lasidao.deckMeta', {
        resDraw: (game.decksLeft && game.decksLeft.resource) || 0,
        resDiscard: (game.discardsLeft && game.discardsLeft.resource) || 0,
        fnDraw: (game.decksLeft && game.decksLeft.function) || 0,
        fnDiscard: (game.discardsLeft && game.discardsLeft.function) || 0,
        bldDraw: (game.decksLeft && game.decksLeft.building) || 0,
        bldDiscard: (game.discardsLeft && game.discardsLeft.building) || 0,
      });
    }`
  );
}

// status branches - replace common corrupted patterns loosely by function rewrite of status block
// Find: if (game.over) { ... } else if (game.phase === 'init_roll')
const statusRe =
  /if \(game\.over\) \{[\s\S]*?\$\('las-status'\)\.textContent =[\s\S]*?\} else if \(game\.phase === 'init_roll'\) \{[\s\S]*?\} else if \(game\.phase === 'produce'\) \{[\s\S]*?\} else if \(game\.phase === 'settle'\) \{[\s\S]*?\} else if \(game\.phase === 'settle_act'\) \{[\s\S]*?\} else if \(game\.phase === 'build'\) \{[\s\S]*?\} else if \(game\.phase === 'round_end'\) \{[\s\S]*?\} else \{[\s\S]*?\}/;

const statusNew = `if (game.over) {
      const names = (game.winners || [])
        .map((id) => {
          const p = (game.players || []).find((x) => x.id === id);
          return p ? p.name : id;
        })
        .join(', ');
      $('las-status').textContent = t('lasidao.statusOver', {
        names: names || t('lasidao.statusOverNobody'),
      });
    } else if (game.phase === 'init_roll') {
      $('las-status').textContent = t('lasidao.statusInit');
    } else if (game.phase === 'produce') {
      $('las-status').textContent = t('lasidao.statusProduce');
    } else if (game.phase === 'settle') {
      $('las-status').textContent = t('lasidao.statusSettle');
    } else if (game.phase === 'settle_act') {
      $('las-status').textContent = t('lasidao.statusSettleAct');
    } else if (game.phase === 'build') {
      $('las-status').textContent = t('lasidao.statusBuild');
    } else if (game.phase === 'round_end') {
      $('las-status').textContent = t('lasidao.statusRoundEnd');
    } else {
      $('las-status').textContent = '';
    }`;

if (statusRe.test(s)) {
  s = s.replace(statusRe, statusNew);
  console.log('status ok');
} else {
  console.log('status miss');
}

// updateDiceHint
s = s.replace(
  /function updateDiceHint\(\) \{[\s\S]*?\n  \}/,
  `function updateDiceHint() {
    const hint = $('las-dice-hint');
    if (!hint) return;
    if (diceAnim.stage === 'rolling') {
      hint.textContent = t('lasidao.diceRolling');
    } else if (diceAnim.stage === 'grouping') {
      hint.textContent = t('lasidao.diceGrouping');
    } else if (diceAnim.stage === 'ready') {
      if (selectedFace == null) {
        hint.textContent = t('lasidao.dicePickFace');
      } else if (!selectedTarget) {
        hint.textContent = t('lasidao.dicePickTarget', { face: selectedFace });
      } else {
        hint.textContent = t('lasidao.diceConfirm');
      }
    } else {
      hint.textContent = '';
    }
  }`
);

// updateDispatchPreview
s = s.replace(
  /function updateDispatchPreview\(\) \{[\s\S]*?\n  \}/,
  `function updateDispatchPreview() {
    const box = $('las-dispatch-preview');
    const confirm = $('btn-las-confirm');
    if (!box || !confirm) return;

    if (selectedFace == null) {
      box.hidden = true;
      confirm.hidden = true;
      return;
    }

    const count = countByFace(diceAnim.finalDice)[selectedFace] || 0;
    if (!selectedTarget) {
      box.hidden = false;
      box.textContent = t('lasidao.previewNeedTarget', {
        face: selectedFace,
        count,
      });
      confirm.hidden = true;
      return;
    }

    let targetTxt = '';
    if (selectedTarget.type === 'area') {
      targetTxt =
        areaLabel(selectedTarget.area) + ' #' + selectedTarget.number;
    } else {
      targetTxt = t('lasidao.targetPersonal', {
        label: selectedTarget.label || '',
      });
    }
    box.hidden = false;
    box.textContent = t('lasidao.previewReady', {
      face: selectedFace,
      count,
      target: targetTxt,
    });
    confirm.hidden = false;
  }`
);

// empty slot text
s = s.replace(
  /empty\.textContent = '\?';/,
  "empty.textContent = t('lasidao.emptySlot');"
);

// listen lang change to re-render
if (!s.includes("i18n:change")) {
  s = s.replace(
    'return { render, hide, bindButtons };',
    `window.addEventListener('i18n:change', () => {
    if (lastGame && netRef) {
      render(lastGame, netRef, { meId: lastMeId });
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(document.getElementById('panel-lasidao'));
      }
    }
  });

  return { render, hide, bindButtons };`
  );
}

fs.writeFileSync(f, s, 'utf8');
console.log('lasidao patched', s.includes('function t(key'), s.includes('statusOver'));

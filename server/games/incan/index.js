'use strict';

const HAZARD_TYPES = ['spider', 'snake', 'mummy', 'fire', 'rock'];
const HAZARD_LABELS = {
  spider: '蜘蛛',
  snake: '毒蛇',
  mummy: '木乃伊',
  fire: '火焰',
  rock: '落石',
};

const TREASURE_VALUES = [1, 2, 3, 4, 5, 5, 7, 7, 9, 9, 11, 11, 13, 14, 15];
const ARTIFACT_VALUES = [5, 7, 8, 10, 12];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildHazardCards(counts) {
  const cards = [];
  for (const type of HAZARD_TYPES) {
    const n = counts[type] || 0;
    for (let i = 0; i < n; i++) {
      cards.push({ type: 'hazard', hazard: type });
    }
  }
  return cards;
}

function createGameState(room) {
  const players = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    tag: p.tag || null,
    tentGems: 0,
    tentArtifacts: [],
    bagGems: 0,
    exploring: true,
    choice: null,
  }));

  const hazardCounts = {};
  for (const t of HAZARD_TYPES) hazardCounts[t] = 3;

  const game = {
    type: 'incan',
    temple: 1,
    maxTemples: 5,
    phase: 'choosing',
    over: false,
    winners: [],
    scores: {},
    hazardCounts,
    artifactQueue: ARTIFACT_VALUES.slice(),
    cardPool: [
      ...TREASURE_VALUES.map((value) => ({ type: 'treasure', value })),
      ...buildHazardCards(hazardCounts),
    ],
    deck: [],
    path: [],
    pathGems: 0,
    pathArtifacts: [],
    roundHazards: {},
    players,
    log: [],
    lastReveal: null,
  };

  startTemple(game);
  return game;
}

function pushLog(game, text) {
  game.log.push({ at: Date.now(), text });
  if (game.log.length > 40) game.log.shift();
}

function explorers(game) {
  return game.players.filter((p) => p.exploring);
}

function startTemple(game) {
  game.phase = 'choosing';
  game.path = [];
  game.pathGems = 0;
  game.pathArtifacts = [];
  game.roundHazards = {};
  game.lastReveal = null;

  for (const p of game.players) {
    p.exploring = true;
    p.bagGems = 0;
    p.choice = null;
  }

  const artifactValue = game.artifactQueue.shift();
  const pile = game.cardPool.slice();
  game.cardPool = [];
  if (artifactValue != null) {
    pile.push({ type: 'artifact', value: artifactValue });
  }
  game.deck = shuffle(pile);

  pushLog(
    game,
    `神庙 ${game.temple}/${game.maxTemples} 开启` +
      (artifactValue != null ? `，神器 ${artifactValue} 分已洗入牌堆` : '')
  );
}

function allExplorersChosen(game) {
  const list = explorers(game);
  if (list.length === 0) return true;
  return list.every((p) => p.choice === 'continue' || p.choice === 'retreat');
}

function splitPoints(total, n) {
  if (n <= 0) return { each: 0, remain: total };
  const each = Math.floor(total / n);
  const remain = total % n;
  return { each, remain };
}

function lockToTent(player, gems, artifacts) {
  player.tentGems += gems;
  if (artifacts && artifacts.length) {
    player.tentArtifacts.push(...artifacts.map((a) => a.value));
  }
  player.bagGems = 0;
  player.exploring = false;
  player.choice = null;
}

function summarizeCard(card) {
  if (card.type === 'treasure') {
    return { type: 'treasure', value: card.value, label: `宝藏 ${card.value}` };
  }
  if (card.type === 'artifact') {
    return { type: 'artifact', value: card.value, label: `神器 ${card.value}` };
  }
  return {
    type: 'hazard',
    hazard: card.hazard,
    label: `灾难·${HAZARD_LABELS[card.hazard] || card.hazard}`,
  };
}

function resolveChoices(game) {
  const active = explorers(game);
  const retreaters = active.filter((p) => p.choice === 'retreat');
  const stayers = active.filter((p) => p.choice === 'continue');

  const reveal = {
    choices: active.map((p) => ({
      id: p.id,
      name: p.name,
      choice: p.choice,
    })),
    retreated: [],
    card: null,
    collapsed: false,
    roundEnded: false,
  };

  if (retreaters.length > 0) {
    const { each, remain } = splitPoints(game.pathGems, retreaters.length);
    const solo = retreaters.length === 1;
    const arts = solo ? game.pathArtifacts.slice() : [];

    for (const p of retreaters) {
      const gainedGems = p.bagGems + each;
      lockToTent(p, gainedGems, arts);
      reveal.retreated.push({
        id: p.id,
        name: p.name,
        gems: gainedGems,
        artifacts: arts.map((a) => a.value),
        solo,
      });
    }

    game.pathGems = remain;
    if (solo) {
      game.pathArtifacts = [];
      pushLog(game, `${retreaters[0].name} 独自返回，带走通道剩余宝石与神器`);
    } else {
      pushLog(
        game,
        `${retreaters.map((p) => p.name).join('、')} 返回，均分通道宝石（神器留场）`
      );
    }
  }

  for (const p of stayers) {
    p.choice = null;
  }

  if (stayers.length === 0) {
    reveal.roundEnded = true;
    game.lastReveal = reveal;
    endTempleRound(game, false, null);
    return;
  }

  const card = game.deck.shift();
  if (!card) {
    reveal.roundEnded = true;
    game.lastReveal = reveal;
    pushLog(game, '牌堆耗尽，本神庙结束');
    endTempleRound(game, false, null);
    return;
  }

  reveal.card = summarizeCard(card);
  game.path.push(card);

  if (card.type === 'treasure') {
    const n = stayers.length;
    const { each, remain } = splitPoints(card.value, n);
    for (const p of stayers) p.bagGems += each;
    game.pathGems += remain;
    pushLog(
      game,
      `翻出宝藏 ${card.value}：探险中 ${n} 人各得 ${each}，余 ${remain} 留通道`
    );
  } else if (card.type === 'artifact') {
    game.pathArtifacts.push(card);
    pushLog(game, `翻出神器（${card.value} 分），暂留通道`);
  } else if (card.type === 'hazard') {
    const h = card.hazard;
    game.roundHazards[h] = (game.roundHazards[h] || 0) + 1;
    pushLog(game, `翻出灾难：${HAZARD_LABELS[h] || h}`);
    if (game.roundHazards[h] >= 2) {
      reveal.collapsed = true;
      reveal.roundEnded = true;
      for (const p of stayers) {
        pushLog(game, `${p.name} 坍塌中丢失随身宝石 ${p.bagGems}`);
        p.bagGems = 0;
        p.exploring = false;
        p.choice = null;
      }
      game.lastReveal = reveal;
      endTempleRound(game, true, h);
      return;
    }
  }

  game.lastReveal = reveal;
  game.phase = 'choosing';
}

function collectCardsForNextTemple(game, collapsed, hazardType) {
  const returned = [];

  for (const c of game.deck) {
    if (c.type === 'artifact') continue; // 未翻出的本庙神器离开游戏
    returned.push(c);
  }

  // 坍塌时移除「最后翻出的那张」同种灾难卡
  const pathCards = game.path.slice();
  let skipLastHazard = collapsed;
  for (let i = pathCards.length - 1; i >= 0; i--) {
    const c = pathCards[i];
    if (c.type === 'artifact') {
      // 未带走神器离开游戏
      continue;
    }
    if (
      skipLastHazard &&
      c.type === 'hazard' &&
      c.hazard === hazardType
    ) {
      skipLastHazard = false;
      if (game.hazardCounts[hazardType] > 0) {
        game.hazardCounts[hazardType] -= 1;
      }
      continue;
    }
    returned.push(c);
  }

  game.cardPool = returned;
  game.deck = [];
  game.path = [];
}

function endTempleRound(game, collapsed, hazardType) {
  for (const p of game.players) {
    if (p.exploring) {
      p.bagGems = 0;
      p.exploring = false;
    }
    p.choice = null;
  }

  if (game.pathArtifacts.length) {
    pushLog(
      game,
      `未带走的神器离开游戏：${game.pathArtifacts.map((a) => a.value).join(', ')}`
    );
  }
  game.pathArtifacts = [];
  game.pathGems = 0;

  if (collapsed && hazardType) {
    pushLog(
      game,
      `神庙坍塌（${HAZARD_LABELS[hazardType]}×2），移除 1 张该灾难卡`
    );
  } else {
    pushLog(game, `神庙 ${game.temple} 探险结束`);
  }

  collectCardsForNextTemple(game, collapsed, hazardType);

  if (game.temple >= game.maxTemples) {
    finishGame(game);
    return;
  }

  game.temple += 1;
  startTemple(game);
}

function playerScore(p) {
  const art = p.tentArtifacts.reduce((s, v) => s + v, 0);
  return p.tentGems + art;
}

function finishGame(game) {
  game.phase = 'game_over';
  game.over = true;

  const ranked = game.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: playerScore(p),
      artifacts: p.tentArtifacts.length,
      tentGems: p.tentGems,
      tentArtifacts: p.tentArtifacts.slice(),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.artifacts - a.artifacts;
    });

  game.scores = {};
  for (const r of ranked) game.scores[r.id] = r;

  const best = ranked[0];
  game.winners = ranked
    .filter((r) => r.score === best.score && r.artifacts === best.artifacts)
    .map((r) => r.id);

  const names = game.winners
    .map((id) => game.players.find((p) => p.id === id).name)
    .join('、');
  pushLog(game, `游戏结束！胜者：${names}`);
}

function applyAction(game, playerId, action) {
  if (!game) return { ok: false, error: '对局未开始' };
  if (game.over) return { ok: false, error: '对局已结束' };
  if (game.phase !== 'choosing') {
    return { ok: false, error: '当前不能抉择' };
  }

  const type = action && action.type;
  if (type !== 'decide') {
    return { ok: false, error: '无效操作' };
  }

  const decision = action.payload && action.payload.decision;
  if (decision !== 'continue' && decision !== 'retreat') {
    return { ok: false, error: '请选择继续或返回' };
  }

  const player = game.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: '你不是对局玩家' };
  if (!player.exploring) {
    return { ok: false, error: '你已在营地，本神庙无需再选' };
  }
  if (player.choice) {
    return { ok: false, error: '你已锁定选择，等待他人' };
  }

  player.choice = decision;

  if (allExplorersChosen(game)) {
    resolveChoices(game);
  }

  return { ok: true };
}

function publicGameState(game, viewerId) {
  if (!game) return null;

  const hiding = game.phase === 'choosing' && !game.over;

  return {
    type: 'incan',
    temple: game.temple,
    maxTemples: game.maxTemples,
    phase: game.phase,
    over: game.over,
    winners: game.winners.slice(),
    scores: game.scores,
    pathGems: game.pathGems,
    pathArtifacts: game.pathArtifacts.map((a) => ({ value: a.value })),
    path: game.path.map(summarizeCard),
    deckLeft: game.deck.length,
    roundHazards: { ...game.roundHazards },
    hazardLabels: HAZARD_LABELS,
    lastReveal: game.lastReveal,
    log: game.log.slice(-14),
    players: game.players.map((p) => {
      const row = {
        id: p.id,
        name: p.name,
        tag: p.tag || null,
        exploring: p.exploring,
        tentGems: p.tentGems,
        tentArtifacts: p.tentArtifacts.slice(),
        bagGems: p.bagGems,
        score: playerScore(p),
        locked: Boolean(p.choice),
      };
      if (!hiding || p.id === viewerId) {
        row.choice = p.choice;
      } else {
        row.choice = null;
      }
      return row;
    }),
    me: viewerId
      ? (() => {
          const p = game.players.find((x) => x.id === viewerId);
          if (!p) return null;
          return {
            id: p.id,
            exploring: p.exploring,
            choice: p.choice,
            canDecide:
              game.phase === 'choosing' &&
              p.exploring &&
              !p.choice &&
              !game.over,
          };
        })()
      : null,
  };
}

function getActingPlayerIds(game) {
  if (!game || game.over || game.phase !== 'choosing') return [];
  return explorers(game)
    .filter((p) => !p.choice)
    .map((p) => p.id);
}

function forceTimeout(game, playerId) {
  return applyAction(game, playerId, {
    type: 'decide',
    payload: { decision: 'continue' },
  });
}

module.exports = {
  id: 'incan',
  label: '印加宝藏',
  minPlayers: 3,
  maxPlayers: 8,
  client: {
    styles: ['/games/incan/style.css'],
    scripts: ['/games/incan/ui.js'],
    panel: '/games/incan/panel.html',
  },
  createGameState,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  forceTimeout,
  HAZARD_LABELS,
};

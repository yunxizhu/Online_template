'use strict';

/**
 * 印加宝藏前端 UI
 */
window.IncanUi = (function () {
  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function choiceLabel(c) {
    if (c === 'continue') return '继续';
    if (c === 'retreat') return '返回';
    return '';
  }

  function hideOthers() {
    const gomoku = $('panel-gomoku');
    if (gomoku) gomoku.hidden = true;
    if (window.SgsUi) window.SgsUi.hide();
  }

  function render(game, net, opts) {
    const panel = $('panel-incan');
    if (!panel) return;
    hideOthers();
    panel.hidden = false;

    const meId = opts && opts.meId;
    const playerNameById = (opts && opts.playerNameById) || ((id) => id);

    $('incan-temple').textContent = `神庙 ${game.temple}/${game.maxTemples}`;
    $('incan-path-gems').textContent = String(game.pathGems || 0);
    $('incan-deck-left').textContent = String(game.deckLeft || 0);

    if (game.over) {
      const names = (game.winners || [])
        .map((id) => {
          const p = (game.players || []).find((x) => x.id === id);
          return p ? p.name : playerNameById(id);
        })
        .join('、');
      $('incan-status').textContent = `游戏结束，胜者：${names || '—'}`;
    } else {
      const exploring = (game.players || []).filter((p) => p.exploring).length;
      const locked = (game.players || []).filter(
        (p) => p.exploring && p.locked
      ).length;
      $('incan-status').textContent = `探险中 ${exploring} 人 · 已锁定 ${locked}/${exploring}（选择互相不可见）`;
    }

    const arts = $('incan-path-artifacts');
    arts.innerHTML = '';
    for (const a of game.pathArtifacts || []) {
      const span = document.createElement('span');
      span.className = 'badge art-badge';
      span.textContent = `神器 ${a.value}`;
      arts.appendChild(span);
    }

    const cards = $('incan-path-cards');
    cards.innerHTML = '';
    for (const c of game.path || []) {
      const span = document.createElement('span');
      span.className =
        'incan-card' +
        (c.type === 'hazard'
          ? ' hazard'
          : c.type === 'artifact'
            ? ' artifact'
            : ' treasure');
      span.textContent = c.label || c.type;
      cards.appendChild(span);
    }

    const hazards = $('incan-hazards');
    hazards.innerHTML = '';
    const labels = game.hazardLabels || {};
    for (const [k, n] of Object.entries(game.roundHazards || {})) {
      if (!n) continue;
      const span = document.createElement('span');
      span.className = 'badge hazard-badge';
      span.textContent = `${labels[k] || k} ×${n}`;
      hazards.appendChild(span);
    }

    const reveal = $('incan-reveal');
    if (game.lastReveal && game.lastReveal.choices) {
      reveal.hidden = false;
      const parts = game.lastReveal.choices.map(
        (c) => `${escapeHtml(c.name)}→${choiceLabel(c.choice)}`
      );
      let extra = '';
      if (game.lastReveal.card) {
        extra += `<br>翻牌：${escapeHtml(game.lastReveal.card.label)}`;
      }
      if (game.lastReveal.collapsed) extra += '<br><strong>神庙坍塌！</strong>';
      reveal.innerHTML =
        `<strong>上轮揭晓</strong>：${parts.join('，')}` + extra;
    } else {
      reveal.hidden = true;
    }

    const me = game.me;
    const canDecide = me && me.canDecide;
    $('incan-actions').hidden = !canDecide;
    $('incan-locked').hidden = !(me && me.exploring && me.choice && !game.over);

    const players = $('incan-players');
    players.innerHTML = '';
    for (const p of game.players || []) {
      const li = document.createElement('li');
      const isMe = meId && p.id === meId;
      let status = p.exploring ? '探险中' : '营地';
      if (p.exploring && p.locked) status += ' · 已锁定';
      if (p.exploring && isMe && p.choice) {
        status += `（你选了${choiceLabel(p.choice)}）`;
      }
      const left = document.createElement('span');
      const Nick = window.PlayerNick;
      left.innerHTML =
        (Nick && Nick.formatHtml
          ? Nick.formatHtml(p.name, p.tag)
          : escapeHtml(p.name)) +
        (isMe ? ' <span class="you">(你)</span>' : '') +
        ` <span class="muted">${status}</span>`;
      left.title =
        Nick && Nick.fullLabel
          ? Nick.fullLabel(p.name, p.tag)
          : p.name || '';
      const right = document.createElement('span');
      right.className = 'muted';
      right.textContent =
        `帐篷${p.tentGems}` +
        (p.tentArtifacts && p.tentArtifacts.length
          ? `+神器[${p.tentArtifacts.join(',')}]`
          : '') +
        (p.exploring ? ` · 随身${p.bagGems}` : '') +
        ` · 计${p.score}`;
      li.appendChild(left);
      li.appendChild(right);
      players.appendChild(li);
    }

    const log = $('incan-log');
    log.innerHTML = '';
    for (const row of (game.log || []).slice().reverse()) {
      const li = document.createElement('li');
      li.textContent = row.text;
      log.appendChild(li);
    }
  }

  function hide() {
    const panel = $('panel-incan');
    if (panel) panel.hidden = true;
  }

  function bindButtons(net) {
    const cont = $('btn-incan-continue');
    const ret = $('btn-incan-retreat');
    if (cont) {
      cont.onclick = () => net.sendAction('decide', { decision: 'continue' });
    }
    if (ret) {
      ret.onclick = () => net.sendAction('decide', { decision: 'retreat' });
    }
  }

  return { render, hide, bindButtons };
})();

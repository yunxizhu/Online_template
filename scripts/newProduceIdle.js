  function renderProduceIdleBar(game) {
    const bar = $('las-produce-idle');
    if (!bar) return;
    if (!game || game.phase !== 'produce') {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    bar.hidden = false;
    bar.innerHTML = '';
    const players = (game.players || [])
      .slice()
      .sort((a, b) => (a.seat || 0) - (b.seat || 0));
    for (const p of players) {
      if (p.left) continue;
      const row = document.createElement('div');
      row.className = 'las-idle-row';
      const swatch = document.createElement('span');
      swatch.className = 'las-die-swatch color-' + playerDieColor(game.players, p.id, game);
      const name = document.createElement('span');
      name.className = 'las-idle-name';
      const Nick = window.PlayerNick;
      name.innerHTML = (Nick && Nick.formatHtml) ? Nick.formatHtml(p.name, p.tag) : escapeHtml(p.name);
      const count = document.createElement('span');
      count.className = 'las-idle-count';
      count.textContent = (p.idleVillagers || 0) + '/' + (p.villagers || 0);
      row.appendChild(swatch);
      row.appendChild(name);
      row.appendChild(count);
      bar.appendChild(row);
    }
  }
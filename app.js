(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  // ---------- Modelo ----------
  const POS = { ARQ: 'Arquero', DEF: 'Defensor', DEL: 'Delantero' };
  const STATS = [['velocidad', 'Velocidad', 'VEL'], ['fisico', 'Físico', 'FIS'], ['pase', 'Pase', 'PAS'], ['tiro', 'Tiro', 'TIR'],
                 ['defensa', 'Defensa', 'DEF'], ['regate', 'Regate', 'REG'], ['arquero', 'Arquero', 'ARQ'], ['agresividad', 'Agresividad', 'AGR']];
  const STAT_DEF = 50; // valor que se asume en jugadores cargados antes de que existiera una estadística
  // Peso de cada estadística según el puesto en que juega
  const PESOS = {
    ARQ: { arquero: .60, fisico: .15, pase: .15, velocidad: .10 },
    DEF: { defensa: .40, fisico: .25, pase: .20, velocidad: .15 },
    DEL: { tiro: .35, regate: .25, velocidad: .20, pase: .20 }
  };
  // Penalización por jugar fuera de puesto
  const FIT = { principal: 1, secundario: .93, otro: .82 };
  const FORMACION = ['ARQ', 'DEF', 'DEF', 'DEL', 'DEL'];
  const SLOTS = { ARQ: [[7, 50]], DEF: [[24, 27], [24, 73]], DEL: [[41, 27], [41, 73]] }; // % en cancha, equipo izquierdo
  const TEAMS = ['Azul', 'Rojo'];

  function rating(p, role) {
    const w = PESOS[role];
    const base = Object.keys(w).reduce((s, k) => s + (Number(p[k]) || 0) * w[k], 0);
    const fit = role === p.puesto1 ? FIT.principal : role === p.puesto2 ? FIT.secundario : FIT.otro;
    return base * fit;
  }
  const overall = p => Math.round(rating(p, p.puesto1));

  // ---------- Armado de equipos ----------
  const PERMS = (() => { // las 30 formas distintas de repartir ARQ, DEF, DEF, DEL, DEL entre 5 jugadores
    const out = new Set();
    const rec = (rest, acc) => rest.length ? rest.forEach((r, i) => rec(rest.filter((_, j) => j !== i), [...acc, r])) : out.add(acc.join(','));
    rec(FORMACION, []);
    return [...out].map(s => s.split(','));
  })();

  function bestLineup(players) {
    let best = null;
    for (const roles of PERMS) {
      const lines = { ARQ: 0, DEF: 0, DEL: 0 };
      let total = 0;
      players.forEach((p, i) => { const r = rating(p, roles[i]); lines[roles[i]] += r; total += r; });
      if (!best || total > best.total) best = { roles, total, lines };
    }
    return best;
  }

  const agr = p => Number(p.agresividad ?? STAT_DEF);
  // Los dos jugadores más agresivos entre los presentes
  const masAgresivos = players => [...players].sort((a, b) => agr(b) - agr(a) || a.nombre.localeCompare(b.nombre)).slice(0, 2); // empate: orden alfabético

  // criterio: '' (solo paridad), 'sep' (los dos más agresivos en equipos distintos) o 'jun' (en el mismo equipo)
  function generate(players, criterio) {
    const n = players.length, splits = [];
    const [ia, ib] = masAgresivos(players).map(p => players.indexOf(p));
    for (let mask = 0; mask < (1 << n); mask++) {
      if (!(mask & 1)) continue; // el primer jugador siempre en el equipo A: evita duplicados espejo
      let bits = 0; for (let i = 0; i < n; i++) if (mask & (1 << i)) bits++;
      if (bits !== n / 2) continue;
      const juntos = ((mask >> ia) & 1) === ((mask >> ib) & 1);
      if ((criterio === 'sep' && juntos) || (criterio === 'jun' && !juntos)) continue;
      const A = players.filter((_, i) => mask & (1 << i)), B = players.filter((_, i) => !(mask & (1 << i)));
      const la = bestLineup(A), lb = bestLineup(B);
      const cost = Math.abs(la.total - lb.total)
        + .5 * (Math.abs(la.lines.ARQ - lb.lines.ARQ) + Math.abs(la.lines.DEF - lb.lines.DEF) + Math.abs(la.lines.DEL - lb.lines.DEL))
        - .02 * (la.total + lb.total); // a igual paridad, preferir que todos jueguen en su puesto
      splits.push({ mask, A, B, la, lb, cost });
    }
    splits.sort((x, y) => x.cost - y.cost);
    const first = splits[0];
    const diff = s => { let c = 0, x = s.mask ^ first.mask; while (x) { c += x & 1; x >>= 1; } return c / 2; }; // jugadores que cambian de equipo
    const second = splits.find(s => s !== first && diff(s) >= 2) || splits[1];
    return [first, second].map(toOption);
  }

  function toOption(s) {
    const tokens = [];
    [[s.A, s.la], [s.B, s.lb]].forEach(([team, lu], t) => {
      const used = { ARQ: 0, DEF: 0, DEL: 0 };
      team.forEach((p, i) => {
        const role = lu.roles[i], [x, y] = SLOTS[role][used[role]++];
        tokens.push({ pid: p.id, nombre: p.nombre, team: t, role, x: t ? 100 - x : x, y });
      });
    });
    return { tokens };
  }

  // ---------- Estado ----------
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const state = { players: [], matches: [], audit: [], config: { sede: '', dia: 5, hora: '' }, user: '', fechaTocada: false,
                  view: 'fichas', sort: { key: 'nombre', dir: 1 }, selected: new Set(), match: null, opt: 0, editId: null, foto: '' };
  const playerById = id => state.players.find(p => p.id === id);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
  }
  // Pregunta con botones Sí / Cancelar
  function ask(msg) {
    return new Promise(res => {
      const d = $('#askDialog');
      $('#askMsg').textContent = msg;
      d.onclose = () => res(d.returnValue === 'si');
      d.returnValue = ''; d.showModal();
    });
  }
  async function guard(fn) {
    try { return await fn(); }
    catch (e) {
      console.error(e);
      toast(e.code === 'permission-denied' ? 'Sin permisos: tu usuario no figura como administrador.' : 'Error: ' + (e.message || e));
    }
  }

  const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const avatar = (p, cls = '') => `<div class="avatar ${cls}">${p && p.foto ? `<img src="${esc(p.foto)}" alt="">` : esc(initials(p && p.nombre))}</div>`;

  // ---------- Auditoría ----------
  async function audit(accion, jugador, detalle = '') {
    await DB.save('auditoria', { ts: new Date().toISOString(), usuario: state.user, accion, jugador, detalle });
  }
  function cambios(antes, despues) {
    const out = [];
    if (antes.nombre !== despues.nombre) out.push(`nombre: ${antes.nombre} → ${despues.nombre}`);
    if (antes.puesto1 !== despues.puesto1) out.push(`puesto principal: ${antes.puesto1} → ${despues.puesto1}`);
    if ((antes.puesto2 || '') !== (despues.puesto2 || '')) out.push(`segundo puesto: ${antes.puesto2 || 'ninguno'} → ${despues.puesto2 || 'ninguno'}`);
    STATS.forEach(([k, n]) => { if (Number(antes[k] ?? STAT_DEF) !== Number(despues[k])) out.push(`${n.toLowerCase()}: ${antes[k] ?? STAT_DEF} → ${despues[k]}`); });
    const et = a => (a.etiquetas || []).join(', ') || 'ninguna';
    if (et(antes) !== et(despues)) out.push(`etiquetas: ${et(antes)} → ${et(despues)}`);
    if ((antes.foto || '') !== (despues.foto || '')) out.push(despues.foto ? 'foto cambiada' : 'foto quitada');
    return out.join(' · ') || 'sin cambios';
  }
  // Búsqueda sin distinguir mayúsculas ni acentos
  const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const fmtTs = ts => new Date(ts).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' });

  function renderAudit() {
    const all = [...state.audit].sort((a, b) => b.ts.localeCompare(a.ts));
    const q = norm($('#auditSearch').value);
    const list = q ? all.filter(a => norm([fmtTs(a.ts), a.accion, a.jugador, a.detalle, a.usuario].join(' ')).includes(q)) : all;
    const cls = { Alta: 'alta', 'Edición': 'edicion', Baja: 'baja' };
    $('#auditCount').textContent = q ? `(${list.length} de ${all.length})` : `(${all.length})`;
    $('#auditList').innerHTML = list.length ? list.map(a => `
      <div class="audit ${cls[a.accion] || ''}">
        <span>${fmtTs(a.ts)}</span>
        <span class="tag">${esc(a.accion)}</span>
        <span><b>${esc(a.jugador)}</b>${a.detalle ? ` — ${esc(a.detalle)}` : ''}<small>${esc(a.usuario)}</small></span>
      </div>`).join('') : `<div class="empty">${q ? 'Ningún movimiento coincide con la búsqueda.' : 'Todavía no hay movimientos registrados.'}</div>`;
  }

  // ---------- Configuración ----------
  function renderConfig() {
    const c = state.config;
    $('#headInfo').innerHTML = [['Sede', c.sede], ['Día', DIAS[c.dia]], ['Horario', c.hora ? c.hora + ' hs' : '']]
      .map(([k, v]) => `<span>${k}: <b>${esc(v || 'sin definir')}</b></span>`).join('');
    $('#cSede').value = c.sede || ''; $('#cDia').value = c.dia; $('#cHora').value = c.hora || '';
    const base = new Date(2020, 0, 5 + c.dia); // una fecha vieja que cae en el día configurado
    $('#fecha').min = isoLocal(base); $('#fecha').step = 7; // el calendario solo habilita ese día de la semana
    if (!state.fechaTocada && !state.match) $('#fecha').value = nextDay();
  }
  async function saveConfig() {
    const c = { id: 'general', sede: $('#cSede').value.trim(), dia: Number($('#cDia').value), hora: $('#cHora').value };
    await guard(async () => { await DB.save('config', c); await reload(); toast('Configuración guardada'); });
  }

  // ---------- Jugadores ----------
  const fichaHTML = p => `
        <div class="top">${avatar(p)}
          <div><h3>${esc(p.nombre)}</h3><span class="muted">PP: ${POS[p.puesto1]}<br>PS: ${p.puesto2 ? POS[p.puesto2] : '—'}</span></div>
          <div class="ovr">${overall(p)}</div>
        </div>
        ${(p.etiquetas || []).length ? `<div class="tags">${p.etiquetas.map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="stats">${STATS.map(([k, , ab]) => `<div>${ab}<b>${p[k] ?? STAT_DEF}</b></div>`).join('')}</div>`;

  // Ficha flotante al pasar el mouse por un jugador en Armar partido
  function bindHover(container) {
    const card = $('#hoverCard');
    const place = e => {
      const w = card.offsetWidth, h = card.offsetHeight;
      card.style.left = clamp(e.clientX + 16, 8, window.innerWidth - w - 8) + 'px';
      card.style.top = clamp(e.clientY + 16, 8, window.innerHeight - h - 8) + 'px';
    };
    container.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return; // en pantallas táctiles no hay ficha flotante
      const el = e.target.closest('[data-pid]'), p = el && playerById(el.dataset.pid);
      if (!p || e.buttons) return card.classList.add('hidden');
      if (card.dataset.pid !== p.id || card.classList.contains('hidden')) { card.innerHTML = fichaHTML(p); card.dataset.pid = p.id; card.classList.remove('hidden'); }
      place(e);
    });
    container.addEventListener('mouseleave', () => card.classList.add('hidden'));
  }

  // Vista de listado: una fila por jugador, con columnas ordenables
  const COLS = [['nombre', 'Jugador', 'txt'], ['puesto1', 'PP', 'txt'], ['puesto2', 'PS', 'txt'], ['general', 'GEN', 'num'],
                ...STATS.map(([k, n, ab]) => [k, ab, 'num', n])];
  const valor = (p, k) => k === 'general' ? overall(p) : k === 'nombre' ? p.nombre : k.startsWith('puesto') ? (p[k] ? POS[p[k]] : '') : Number(p[k] ?? STAT_DEF);
  const svg = d => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONO = {
    lapiz: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
    tacho: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>')
  };
  function tablaHTML(list) {
    const { key, dir } = state.sort, tipo = (COLS.find(c => c[0] === key) || [])[2];
    const rows = [...list].sort((a, b) => {
      const va = valor(a, key), vb = valor(b, key);
      const c = tipo === 'num' ? va - vb : String(va).localeCompare(String(vb));
      return (c || a.nombre.localeCompare(b.nombre)) * dir;
    });
    return `<div class="table-wrap"><table class="ptable"><thead><tr>${COLS.map(([k, label, t, title]) => `
      <th class="${t}" aria-sort="${key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">
        <button type="button" data-sort="${k}" title="Ordenar por ${esc(title || label)}">${label}<span class="arrow">${key === k ? (dir > 0 ? '▲' : '▼') : ''}</span></button></th>`).join('')}
      <th>Etiquetas</th><th></th></tr></thead><tbody>${rows.map(p => `
      <tr><td class="who">${avatar(p)}<b>${esc(p.nombre)}</b></td><td>${POS[p.puesto1]}</td><td>${p.puesto2 ? POS[p.puesto2] : '—'}</td>
        <td class="num gen">${overall(p)}</td>${STATS.map(([k]) => `<td class="num">${p[k] ?? STAT_DEF}</td>`).join('')}
        <td class="tags-cell">${(p.etiquetas || []).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}</td>
        <td class="acts"><button class="icon-btn" data-edit="${p.id}" title="Editar" aria-label="Editar a ${esc(p.nombre)}">${ICONO.lapiz}</button><button class="icon-btn danger" data-del="${p.id}" title="Eliminar" aria-label="Eliminar a ${esc(p.nombre)}">${ICONO.tacho}</button></td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function renderPlayers() {
    const all = [...state.players].sort((a, b) => a.nombre.localeCompare(b.nombre));
    const q = norm($('#playerSearch').value);
    const list = q ? all.filter(p => norm([p.nombre, POS[p.puesto1], p.puesto2 ? POS[p.puesto2] : '', ...(p.etiquetas || [])].join(' ')).includes(q)) : all;
    $('#playersCount').textContent = q ? `(${list.length} de ${all.length})` : `(${all.length})`;
    $('#seedBtn').classList.toggle('hidden', all.length >= 10);
    $('#seedBtn').textContent = `Cargar ${10 - all.length} jugadores de prueba`;
    const lista = state.view === 'lista';
    $$('#viewToggle button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    $('#playersGrid').classList.toggle('grid', !lista);
    if (lista && list.length) { $('#playersGrid').innerHTML = tablaHTML(list); renderSelect(); return; }
    $('#playersGrid').innerHTML = list.length ? list.map(p => `
      <div class="pcard">${fichaHTML(p)}
        <div class="actions">
          <button class="btn small" data-edit="${p.id}">Editar</button>
          <button class="btn small danger" data-del="${p.id}">Eliminar</button>
        </div>
      </div>`).join('') : `<div class="empty">${q ? 'Ningún jugador coincide con la búsqueda.' : 'Todavía no hay jugadores cargados.'}</div>`;
    renderSelect();
  }

  function openPlayer(p) {
    state.editId = p ? p.id : null;
    state.foto = p ? p.foto || '' : '';
    $('#playerDialogTitle').textContent = p ? 'Editar jugador' : 'Nuevo jugador';
    $('#pNombre').value = p ? p.nombre : '';
    $('#pPuesto1').value = p ? p.puesto1 : 'DEF';
    $('#pPuesto2').value = p ? p.puesto2 || '' : '';
    STATS.forEach(([k]) => { $('#s_' + k).value = p ? (p[k] ?? STAT_DEF) : 60; });
    $$('.tag-input').forEach((inp, i) => { inp.value = (p && p.etiquetas && p.etiquetas[i]) || ''; });
    renderPhoto();
    $('#playerDialog').showModal();
  }
  const renderPhoto = () => { $('#photoPreview').innerHTML = state.foto ? `<img src="${state.foto}" alt="">` : esc(initials($('#pNombre').value)); };

  // Reduce la foto a 240x240 para poder guardarla dentro de la base de datos
  function resizePhoto(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const S = 240, c = document.createElement('canvas'); c.width = c.height = S;
        const m = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
        URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', .8));
      };
      img.onerror = rej; img.src = URL.createObjectURL(file);
    });
  }

  async function savePlayer() {
    const p = { id: state.editId || undefined, nombre: $('#pNombre').value.trim(), puesto1: $('#pPuesto1').value, puesto2: $('#pPuesto2').value, foto: state.foto };
    if (p.puesto2 === p.puesto1) p.puesto2 = '';
    p.etiquetas = [...new Set($$('.tag-input').map(i => i.value.trim()).filter(Boolean))].slice(0, 4);
    STATS.forEach(([k]) => { p[k] = clamp(parseInt($('#s_' + k).value, 10) || 1, 1, 99); });
    const antes = state.editId ? playerById(state.editId) : null;
    await guard(async () => {
      await DB.save('jugadores', p);
      await audit(antes ? 'Edición' : 'Alta', p.nombre, antes ? cambios(antes, p) : `${POS[p.puesto1]}, general ${overall(p)}`);
      await reload(); toast('Jugador guardado');
    });
  }

  const EJEMPLO = [['Tato', 'ARQ', 'DEF'], ['Lucho', 'DEF', 'DEL'], ['Nico', 'DEF', ''], ['Maxi', 'DEL', 'DEF'], ['Fede', 'DEL', ''], ['Santi', 'ARQ', ''],
                   ['Juampi', 'DEF', 'ARQ'], ['Gonza', 'DEF', 'DEL'], ['Seba', 'DEL', ''], ['Pablo', 'DEL', 'DEF'], ['Rodri', 'DEF', ''], ['Mati', 'DEL', '']];
  // Foto genérica (silueta sobre un color) para los jugadores de prueba
  function fotoPrueba(nombre) {
    const hue = [...nombre].reduce((s, c) => s + c.charCodeAt(0) * 37, 0) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="hsl(${hue},55%,42%)"/>`
      + `<circle cx="120" cy="96" r="46" fill="#fff" fill-opacity=".85"/><path d="M30 240c0-58 40-92 90-92s90 34 90 92z" fill="#fff" fill-opacity=".85"/></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  async function seed() {
    const rnd = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
    await guard(async () => {
      const usados = new Set(state.players.map(p => p.nombre));
      const faltan = EJEMPLO.filter(e => !usados.has(e[0])).slice(0, 10 - state.players.length);
      for (const [nombre, puesto1, puesto2] of faltan) {
        const p = { nombre, puesto1, puesto2, foto: fotoPrueba(nombre) };
        STATS.forEach(([k]) => { p[k] = rnd(45, 80); });
        p.arquero = puesto1 === 'ARQ' ? rnd(65, 88) : puesto2 === 'ARQ' ? rnd(50, 70) : rnd(20, 45);
        if (puesto1 === 'DEF') p.defensa = rnd(68, 88);
        if (puesto1 === 'DEL') p.tiro = rnd(68, 88);
        await DB.save('jugadores', p);
        await audit('Alta', p.nombre, 'jugador de prueba');
      }
      await reload();
    });
  }

  // ---------- Armar partido ----------
  function nextDay() { // próxima fecha que cae en el día configurado
    const d = new Date(); d.setDate(d.getDate() + (state.config.dia - d.getDay() + 7) % 7);
    return isoLocal(d);
  }
  const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const diaValido = f => !!f && new Date(f + 'T12:00:00').getDay() === state.config.dia;

  function renderSelect() {
    const list = [...state.players].sort((a, b) => a.nombre.localeCompare(b.nombre));
    for (const id of [...state.selected]) if (!playerById(id)) state.selected.delete(id);
    $('#selectGrid').innerHTML = list.length ? list.map(p => `
      <label class="sel ${state.selected.has(p.id) ? 'on' : ''}" data-pid="${p.id}">
        <input type="checkbox" data-sel="${p.id}" ${state.selected.has(p.id) ? 'checked' : ''}>
        ${avatar(p)}<span>${esc(p.nombre)}<small>${p.puesto1}${p.puesto2 ? ' / ' + p.puesto2 : ''}</small></span><b>${overall(p)}</b>
      </label>`).join('') : '<div class="empty">Primero cargá jugadores en la pestaña Jugadores.</div>';
    syncLock();
  }
  function updateCount() {
    const n = state.selected.size;
    $('#selCount').textContent = `${n} / 10 seleccionados`;
    $('#generateBtn').disabled = n !== 10 || !!state.match;
  }
  // Con equipos armados no se puede volver a armar ni cambiar los tildados: primero hay que borrar los equipos
  function syncLock() {
    const armado = !!state.match;
    $$('#selectGrid [data-sel]').forEach(c => { c.disabled = armado; });
    $('#selAllBtn').disabled = $('#selNoneBtn').disabled = armado;
    $$('#criterio input').forEach(c => { c.disabled = armado; if (armado) c.checked = c.value === (state.match.criterio || ''); });
    updateCount();
  }

  function renderField() {
    const wrap = $('#fieldWrap');
    wrap.classList.toggle('hidden', !state.match);
    syncLock();
    if (!state.match) return;
    $$('.opts button').forEach(b => b.classList.toggle('active', Number(b.dataset.opt) === state.opt));
    const tokens = state.match.opciones[state.opt].tokens;
    const pOf = t => playerById(t.pid) || { nombre: t.nombre };
    const r = t => { const p = playerById(t.pid); return p ? rating(p, t.role) : 0; };

    $('#summary').innerHTML = [0, 1].map(t => {
      const tk = tokens.filter(x => x.team === t);
      const line = role => { const l = tk.filter(x => x.role === role); return l.length ? Math.round(l.reduce((s, x) => s + r(x), 0) / l.length) : '-'; };
      const tot = tk.length ? Math.round(tk.reduce((s, x) => s + r(x), 0) / tk.length) : '-';
      return `<div class="team t${t}"><strong>Equipo ${TEAMS[t]}</strong><span class="tot">${tot}</span>
        <span>ARQ ${line('ARQ')}</span><span>DEF ${line('DEF')}</span><span>DEL ${line('DEL')}</span><span>${tk.length} jugadores</span></div>`;
    }).join('');

    const top = (state.match.agresivos || []).map(playerById).filter(Boolean);
    const crit = state.match.criterio;
    $('#criterioNota').textContent = crit && top.length === 2
      ? `Armado con los más agresivos ${crit === 'sep' ? 'separados' : 'juntos'}: ${top[0].nombre} (${agr(top[0])}) y ${top[1].nombre} (${agr(top[1])}).` : '';
    const pitch = $('#pitch');
    $$('.tok', pitch).forEach(e => e.remove());
    tokens.forEach(t => {
      const el = document.createElement('div');
      el.className = `tok t${t.team}`;
      el.dataset.pid = t.pid;
      el.style.left = t.x + '%'; el.style.top = t.y + '%';
      el.innerHTML = `${avatar(pOf(t))}<span class="nm">${esc(pOf(t).nombre)}</span><span class="rl">${t.role} · ${Math.round(r(t))}</span>`;
      bindDrag(el, t, tokens, pitch);
      pitch.appendChild(el);
    });
  }

  function bindDrag(el, tok, tokens, pitch) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId); el.classList.add('drag'); $('#hoverCard').classList.add('hidden');
      const rect = pitch.getBoundingClientRect(), orig = { x: tok.x, y: tok.y };
      const move = ev => {
        tok.x = clamp((ev.clientX - rect.left) / rect.width * 100, 3, 97);
        tok.y = clamp((ev.clientY - rect.top) / rect.height * 100, 7, 93);
        el.style.left = tok.x + '%'; el.style.top = tok.y + '%';
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        const px = t => [t.x / 100 * rect.width, t.y / 100 * rect.height];
        const [mx, my] = px(tok);
        const near = tokens.filter(t => t !== tok).map(t => { const [x, y] = px(t); return { t, d: Math.hypot(x - mx, y - my) }; }).sort((a, b) => a.d - b.d)[0];
        tok.x = orig.x; tok.y = orig.y; // no hay movimiento libre: vuelve a su lugar...
        if (near && near.d < 40) { // ...salvo que se suelte encima de otro jugador: intercambian lugar, puesto y equipo
          const o = near.t, dest = { team: o.team, role: o.role, x: o.x, y: o.y };
          Object.assign(o, { team: tok.team, role: tok.role, x: orig.x, y: orig.y });
          Object.assign(tok, dest);
        }
        renderField();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up, { once: true });
      el.addEventListener('pointercancel', up, { once: true });
    });
  }

  async function saveMatch() {
    const fecha = $('#fecha').value;
    if (!diaValido(fecha)) return toast(`La fecha tiene que ser un ${DIAS[state.config.dia].toLowerCase()}`);
    const existe = state.matches.find(m => m.id === fecha);
    const pregunta = existe && state.match.id !== fecha ? `Ya hay un partido guardado para el ${fmtFecha(fecha)}. ¿Estás seguro de reemplazarlo?` : '¿Estás seguro de guardar?';
    if (!await ask(pregunta)) return;
    const m = { id: fecha, fecha, presentes: [...state.selected], opciones: state.match.opciones, criterio: state.match.criterio || '', agresivos: state.match.agresivos || [], elegida: state.opt, actualizado: new Date().toISOString() };
    await guard(async () => { await DB.save('partidos', m); state.match.id = fecha; await reload(); toast('Partido guardado'); });
  }

  // ---------- Historial ----------
  const fmtFecha = f => new Date(f + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  function renderHistory() {
    const all = [...state.matches].sort((a, b) => b.fecha.localeCompare(a.fecha));
    const desde = $('#histDesde').value, hasta = $('#histHasta').value, q = desde || hasta;
    const list = all.filter(m => (!desde || m.fecha >= desde) && (!hasta || m.fecha <= hasta));
    $('#historyCount').textContent = q ? `(${list.length} de ${all.length})` : `(${all.length})`;
    $('#historyList').innerHTML = list.length ? list.map(m => {
      const tk = m.opciones[m.elegida || 0].tokens;
      const names = t => tk.filter(x => x.team === t).map(x => `${esc((playerById(x.pid) || x).nombre)} <span class="muted">${x.role}</span>`).join('<br>');
      return `<div class="hist"><h3>${fmtFecha(m.fecha)}</h3>
        <div class="teams"><div class="a"><b>Equipo ${TEAMS[0]}</b><br>${names(0)}</div><div class="b"><b>Equipo ${TEAMS[1]}</b><br>${names(1)}</div></div>
        <button class="btn small" data-open="${m.id}">Ver / editar en cancha</button>
        <button class="btn small danger" data-delmatch="${m.id}">Eliminar</button></div>`;
    }).join('') : `<div class="empty">${q ? 'No hay partidos entre esas fechas.' : 'Todavía no hay partidos guardados.'}</div>`;
  }

  function openMatch(id) {
    const m = state.matches.find(x => x.id === id); if (!m) return;
    state.match = JSON.parse(JSON.stringify(m));
    state.selected = new Set(m.presentes); state.opt = m.elegida || 0;
    $('#fecha').value = m.fecha;
    renderSelect(); renderField(); showTab('armar');
  }

  // ---------- General ----------
  function showTab(name) {
    $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    ['jugadores', 'armar', 'historial', 'config', 'auditoria'].forEach(t => $('#tab-' + t).classList.toggle('hidden', t !== name));
  }

  async function reload() {
    let cfg;
    [state.players, state.matches, state.audit, cfg] = await Promise.all([DB.list('jugadores'), DB.list('partidos'), DB.list('auditoria'), DB.list('config')]);
    state.config = { sede: '', dia: 5, hora: '', ...(cfg.find(c => c.id === 'general') || {}) };
    renderPlayers(); renderHistory(); renderField(); renderConfig(); renderAudit();
  }

  function bind() {
    $$('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    $('#pPuesto1').innerHTML = Object.entries(POS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    $('#pPuesto2').innerHTML = '<option value="">— Ninguno —</option>' + $('#pPuesto1').innerHTML;
    $('#statsInputs').innerHTML = STATS.map(([k, n]) => `<label>${n}<input type="number" id="s_${k}" min="1" max="99" required></label>`).join('');
    $('#fecha').value = nextDay();
    $('#fecha').onchange = e => {
      if (!diaValido(e.target.value)) { e.target.value = nextDay(); state.fechaTocada = false; return toast(`Solo se pueden elegir días ${DIAS[state.config.dia].toLowerCase()}`); }
      state.fechaTocada = true;
    };
    bindHover($('#selectGrid')); bindHover($('#pitch'));
    $('#cDia').innerHTML = DIAS.map((d, i) => `<option value="${i}">${d}</option>`).join('');
    $('#configForm').onsubmit = e => { e.preventDefault(); saveConfig(); };
    $('#version').textContent = 'v' + (window.APP_VERSION || '');

    $('#addPlayerBtn').onclick = () => openPlayer(null);
    $('#seedBtn').onclick = seed;
    $('#playerCancel').onclick = () => $('#playerDialog').close();
    $('#playerForm').onsubmit = async e => {
      e.preventDefault(); // la ficha queda abierta hasta confirmar
      if (!await ask('¿Estás seguro de guardar?')) return;
      $('#playerDialog').close(); savePlayer();
    };
    $('#pNombre').oninput = () => { if (!state.foto) renderPhoto(); };
    $('#photoInput').onchange = async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (f) { try { state.foto = await resizePhoto(f); renderPhoto(); } catch { toast('No se pudo leer la imagen'); } }
    };
    $('#photoRemove').onclick = () => { state.foto = ''; renderPhoto(); };

    $('#playersGrid').onclick = e => {
      const srt = e.target.closest('[data-sort]');
      if (srt) { // primer click: texto A→Z y números de mayor a menor; segundo click: al revés
        const k = srt.dataset.sort, num = (COLS.find(c => c[0] === k) || [])[2] === 'num';
        state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: num ? -1 : 1 };
        return renderPlayers();
      }
      const btn = e.target.closest('[data-edit],[data-del]') || {}, ed = (btn.dataset || {}).edit, del = (btn.dataset || {}).del;
      if (ed) openPlayer(playerById(ed));
      if (del && confirm(`¿Eliminar a ${playerById(del).nombre}?`)) guard(async () => { const n = playerById(del).nombre; await DB.remove('jugadores', del); await audit('Baja', n); await reload(); });
    };
    $('#selectGrid').onchange = e => {
      const id = e.target.dataset.sel; if (!id) return;
      if (e.target.checked && state.selected.size >= 10) { e.target.checked = false; return toast('Ya hay 10 jugadores seleccionados'); }
      e.target.checked ? state.selected.add(id) : state.selected.delete(id);
      e.target.closest('.sel').classList.toggle('on', e.target.checked);
      updateCount();
    };
    $('#selAllBtn').onclick = () => {
      const list = [...state.players].sort((a, b) => a.nombre.localeCompare(b.nombre));
      state.selected = new Set(list.slice(0, 10).map(p => p.id));
      if (list.length > 10) toast('Hay más de 10 jugadores: se seleccionaron los primeros 10');
      renderSelect();
    };
    $('#criterio').onchange = e => { if (e.target.checked) $$('#criterio input').forEach(c => { if (c !== e.target) c.checked = false; }); };
    $('#selNoneBtn').onclick = () => { state.selected.clear(); renderSelect(); };
    $('#generateBtn').onclick = () => {
      const criterio = ($('#criterio input:checked') || {}).value || '';
      const presentes = [...state.selected].map(playerById);
      state.match = { id: null, criterio, agresivos: masAgresivos(presentes).map(p => p.id), opciones: generate(presentes, criterio) };
      state.opt = 0; renderField();
      $('#fieldWrap').scrollIntoView({ behavior: 'smooth' });
    };
    $$('.opts button').forEach(b => b.onclick = () => { state.opt = Number(b.dataset.opt); renderField(); });
    $('#playerSearch').oninput = renderPlayers;
    try { if (localStorage.getItem('futbol_vista') === 'lista') state.view = 'lista'; } catch {}
    $('#viewToggle').onclick = e => {
      const v = e.target.dataset.view; if (!v) return;
      state.view = v; try { localStorage.setItem('futbol_vista', v); } catch {}
      renderPlayers();
    };
    $('#auditSearch').oninput = renderAudit;
    $('#histDesde').onchange = $('#histHasta').onchange = renderHistory;
    $('#histClear').onclick = () => { $('#histDesde').value = $('#histHasta').value = ''; renderHistory(); };
    $('#saveMatchBtn').onclick = saveMatch;
    $('#clearMatchBtn').onclick = async () => {
      if (!await ask('¿Borrar los equipos armados y arrancar de cero?')) return;
      state.match = null; state.opt = 0; state.selected.clear(); state.fechaTocada = false;
      $$('#criterio input').forEach(c => { c.checked = false; });
      $('#fecha').value = nextDay();
      renderSelect(); renderField();
    };
    $('#historyList').onclick = e => {
      const op = e.target.dataset.open, del = e.target.dataset.delmatch;
      if (op) openMatch(op);
      if (del && confirm(`¿Eliminar el partido del ${fmtFecha(del)}?`)) guard(async () => { await DB.remove('partidos', del); await reload(); });
    };
    $('#loginForm').onsubmit = async e => {
      e.preventDefault(); $('#loginError').textContent = '';
      try { await DB.login($('#loginEmail').value, $('#loginPass').value); }
      catch { $('#loginError').textContent = 'Email o contraseña incorrectos.'; }
    };
    $('#passToggle').onclick = () => {
      const inp = $('#loginPass'), ver = inp.type === 'password';
      inp.type = ver ? 'text' : 'password';
      const txt = ver ? 'Ocultar contraseña' : 'Mostrar contraseña';
      Object.assign($('#passToggle'), { title: txt, ariaLabel: txt, ariaPressed: String(ver) });
    };
    $('#logoutBtn').onclick = () => { $('#loginPass').value = ''; $('#loginPass').type = 'password'; $('#passToggle').ariaPressed = 'false'; DB.logout(); };
  }

  async function start() {
    bind();
    let mode = 'local';
    try { mode = await DB.init(); } catch (e) { console.error(e); toast('No se pudo conectar con Firebase'); }
    DB.onAuth(user => {
      $('#login').classList.toggle('hidden', !!user);
      $('#app').classList.toggle('hidden', !user);
      if (!user) return;
      state.user = user.email;
      $('#modeBadge').textContent = mode === 'firebase' ? user.email : 'Modo local (este navegador)';
      $('#logoutBtn').classList.toggle('hidden', mode !== 'firebase');
      guard(reload);
    });
  }
  start();
})();

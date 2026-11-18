/* Contrôleur d'intégration V9 — chargé après le moteur V8.
 * La V8 reste disponible pour le mode local ; ce contrôleur ne détourne que
 * les actions exécutées dans un salon en ligne.
 */
(function () {
  'use strict';

  const mp = window.CanonMultiplayerV9;
  const adapter = window.CanonMultiplayerV9Adapter;
  if (!mp || !adapter) throw new Error('Modules multijoueur V9 manquants.');

  let state = null;
  let ownPrivate = null;
  let setupProfiles = [];
  let members = [];
  let localSetupPlayer = null;
  let setupUnsub = null;
  let membersUnsub = null;
  let preparingTurn = false;
  let submittingTurn = false;
  let committingRevision = null;
  let renderedRevision = -1;

  const originalAttach = attachOnlineRoom;
  const originalLeave = leaveOnlineRoom;
  const originalCheckSetup = checkSetup;
  const originalConfirmPick = confirmPick;
  const originalPlayHandCard = playHandCard;
  const originalEndGame = endGame;
  const originalNewGame = newGame;

  function online() {
    return !!(v8RoomCode && v8User && v8Db && state);
  }

  function uidList() {
    return state ? state.players.map(p => p.uid) : [];
  }

  function ownIndex() {
    return state ? state.players.findIndex(p => p.uid === v8User.uid) : -1;
  }

  function ensureLobbyControls() {
    const box = document.getElementById('online-room-message');
    if (!box) return;
    if (!document.getElementById('v9-room-msg')) {
      const msg = document.createElement('p');
      msg.id = 'v9-room-msg';
      msg.textContent = 'Connexion au salon…';
      box.prepend(msg);
    }
    if (!document.getElementById('v9-prepare')) {
      const prepare = document.createElement('button');
      prepare.id = 'v9-prepare';
      prepare.className = 'btn btn-gold';
      prepare.textContent = 'Préparer mon vigneron';
      prepare.style.marginTop = '12px';
      prepare.onclick = prepareMyVigneron;
      box.appendChild(prepare);
    }
    if (!document.getElementById('v9-start')) {
      const start = document.createElement('button');
      start.id = 'v9-start';
      start.className = 'btn btn-gold';
      start.textContent = 'Lancer la partie';
      start.style.marginTop = '10px';
      start.style.display = 'none';
      start.onclick = startOnlineGame;
      box.appendChild(start);
    }
    refreshLobby();
  }

  function refreshLobby() {
    const prepare = document.getElementById('v9-prepare');
    const start = document.getElementById('v9-start');
    const box = document.getElementById('online-room-message');
    if (!prepare || !start) return;
    const ownReady = !!(v8User && setupProfiles.some(p => p.uid === v8User.uid && p.ready));
    prepare.textContent = ownReady ? 'Modifier ma préparation' : 'Préparer mon vigneron';
    prepare.style.display = state ? 'none' : 'block';
    const readyCount = members.filter(member =>
      setupProfiles.some(profile => profile.uid === member.uid && profile.ready === true)
    ).length;
    const allReady = members.length >= 2 && readyCount === members.length;
    start.style.display = v8IsHost && !state ? 'block' : 'none';
    start.disabled = !allReady;
    if (box) {
      let note = box.querySelector('.v9-ready-note');
      if (!note) {
        note = document.createElement('p');
        note.className = 'v9-ready-note';
        note.style.marginTop = '8px';
        box.appendChild(note);
      }
      note.textContent = state
        ? 'La partie est lancée. Les tours sont synchronisés entre les téléphones.'
        : readyCount + ' / ' + members.length + ' joueur(s) prêt(s). Il faut au moins 2 joueurs.';
    }
  }

  async function prepareMyVigneron() {
    try {
      if (!v8User) await ensureOnlineUser();
      const member = members.find(m => m.uid === v8User.uid);
      const savedProfile = setupProfiles.find(profile => profile.uid === v8User.uid);
      let p;
      if (savedProfile && (!ownPrivate || !ownPrivate.hand)) {
        throw new Error('Chargement de ta main en cours. Attends quelques secondes puis réessaie.');
      }
      if (savedProfile && ownPrivate && ownPrivate.hand) {
        p = adapter.hydratePlayer(savedProfile, ownPrivate, { cdm: ALL_CDM, mat: ALL_MAT });
      } else {
        p = {
          name: member && member.name ? member.name : onlinePlayerName(),
          cepage: rand(CEPAGES),
          terroir: rand(TERROIRS),
          mode: null,
          q: 0, a: 0, r: 0,
          cdm: pickN(ALL_CDM, 3).map(c => ({ ...c, played: false })),
          mat: pickN(ALL_MAT, 3).map(c => ({ ...c, played: false }))
        };
      }
      localSetupPlayer = p;
      G.nb = 1;
      G.players = [p];
      G.setupP = 0;
      G.soloMode = false;
      renderSetupTabs();
      renderSetupBody();
      go('p-setup');
    } catch (err) {
      setOnlineStatus(firebaseFriendlyError(err), true);
    }
  }

  async function saveMyPreparation() {
    const p = G.players[0];
    if (!p || !p.mode) {
      toast('Choisis ton mode agricole avant de valider.', 'warn');
      return;
    }
    try {
      localSetupPlayer = p;
      const profile = adapter.publicProfile(p, v8User.uid);
      await mp.saveOwnSetup(profile, p);
      setOnlineStatus('Préparation enregistrée. En attente des autres joueurs.');
      go('p-online-lobby');
      refreshLobby();
    } catch (err) {
      toast(firebaseFriendlyError(err), 'warn');
    }
  }

  async function startOnlineGame() {
    try {
      if (!v8IsHost) throw new Error('Seul l’hôte peut lancer la partie.');
      // La requête Firestore est déjà ordonnée par joinedAt : conserver cet ordre exact.
      const orderedMembers = [...members];
      if (orderedMembers.length < 2 || orderedMembers.length > 4) {
        throw new Error('Il faut entre 2 et 4 joueurs dans le salon.');
      }
      const byUid = new Map(setupProfiles.map(p => [p.uid, p]));
      const profiles = orderedMembers.map(m => byUid.get(m.uid));
      if (profiles.some(p => !p || p.ready !== true)) {
        throw new Error('Tous les joueurs doivent avoir terminé leur préparation.');
      }
      if (!localSetupPlayer && ownPrivate && ownPrivate.hand) {
        const ownProfile = byUid.get(v8User.uid);
        if (ownProfile) localSetupPlayer = adapter.hydratePlayer(ownProfile, ownPrivate, { cdm: ALL_CDM, mat: ALL_MAT });
      }
      if (!localSetupPlayer || localSetupPlayer.mode == null) {
        throw new Error('L’hôte doit préparer son vigneron et charger sa main privée.');
      }
      const uids = orderedMembers.map(m => m.uid);
      G = {
        nb: profiles.length,
        players: profiles.map(p => ({ ...p, cdm: [], mat: [] })),
        setupP: 0,
        saisonIdx: 0,
        tourInSaison: 0,
        meteo: rand(SAISONS[0].meteos),
        evenement: EVENEMENTS.hiver ? rand(EVENEMENTS.hiver) : null,
        currentP: 0,
        drawn: [],
        chosen: null,
        allChosen: [],
        selectedHandCard: null,
        soloMode: false,
        aiDiff: 'normal',
        aiIdx: 1
      };
      const initial = adapter.buildInitialState(G, uids);
      await mp.createGame(initial);
      toast('La partie est lancée !');
    } catch (err) {
      toast(firebaseFriendlyError(err), 'warn');
    }
  }

  function applyPublic(next) {
    if (committingRevision !== null && Number(next.revision) > committingRevision) {
      committingRevision = null;
      submittingTurn = false;
    }
    state = next;
    if (!state || !Array.isArray(state.players)) return;
    if (v8User && !state.players.some(p => p.uid === v8User.uid)) {
      setOnlineStatus('Cette partie a déjà commencé sans toi. Demande à l’hôte de créer un nouveau salon.', true);
      go('p-online-lobby');
      refreshLobby();
      return;
    }
    const previous = G.players || [];
    G.nb = state.players.length;
    G.players = state.players.map((p, i) => {
      const old = previous.find(x => x.uid === p.uid) || {};
      return { ...p, cdm: old.cdm || [], mat: old.mat || [] };
    });
    G.saisonIdx = Number(state.saisonIdx) || 0;
    G.tourInSaison = Number(state.tourInSaison) || 0;
    G.meteo = state.meteo || null;
    G.evenement = state.evenement || null;
    G.currentP = G.players.findIndex(p => p.uid === state.currentPlayerUid);
    if (G.currentP < 0) G.currentP = 0;
    G.allChosen = (state.allChosen || []).map(item => ({
      player: G.players.findIndex(p => p.uid === item.playerUid),
      card: item.card
    })).filter(item => item.player >= 0);
    G.chosen = null;
    renderedRevision = -1;
    if (ownPrivate) applyPrivate(ownPrivate);
    refreshLobby();
    renderOnlineGame();
  }

  function applyPrivate(data) {
    ownPrivate = data || null;
    if (!state || !ownPrivate) return;
    const idx = ownIndex();
    if (idx < 0) return;
    try {
      const hydrated = adapter.hydratePlayer(
        state.players[idx],
        ownPrivate,
        { cdm: ALL_CDM, mat: ALL_MAT }
      );
      G.players[idx] = { ...G.players[idx], ...hydrated };
      G.drawn = Array.isArray(ownPrivate.drawn) ? ownPrivate.drawn : [];
      renderOnlineGame();
    } catch (err) {
      console.error('[Canon V9] main privée', err);
    }
  }

  function renderScoreboard() {
    const rows = G.players.map(player => {
      const total = player.q * 2 + player.a + player.r;
      return '<div class="auto-row"><span><b>' + player.name + '</b></span><span>⭐ ' +
        player.q + ' · 🌸 ' + player.a + ' · 🍾 ' + player.r +
        ' <b style="color:var(--gold2);">= ' + total + ' pts</b></span></div>';
    }).join('');
    return '<div class="card" style="margin-top:14px;"><div class="card-top"></div>' +
      '<div class="cname" style="font-size:1rem;">📊 Scores en direct</div>' +
      '<div class="auto-score">' + rows + '</div></div>';
  }

  function renderOnlineGame() {
    if (!state) return;
    if (state.status === 'finished') {
      originalEndGame();
      return;
    }
    if (state.status !== 'playing') return;
    renderGameHeader();
    renderGameTabs();
    const isMyTurn = state.currentPlayerUid === v8User.uid;
    if (!isMyTurn) {
      document.getElementById('g-body').innerHTML =
        '<div class="card center"><div class="cname">🍇 Au tour de ' +
        (G.players[G.currentP] ? G.players[G.currentP].name : 'un autre vigneron') +
        '</div><p>Les cartes de ce joueur sont privées. Le jeu avancera automatiquement après son choix.</p></div>';
      document.getElementById('g-actions').innerHTML = '';
      document.getElementById('g-hand').innerHTML = '';
      document.getElementById('g-body').insertAdjacentHTML('beforeend', renderScoreboard());
      go('p-game');
      return;
    }
    if (submittingTurn) {
      document.getElementById('g-body').innerHTML = '<p class="center">Validation du choix en cours…</p>';
      document.getElementById('g-hand').innerHTML = '';
      document.getElementById('g-actions').innerHTML = '';
      go('p-game');
      return;
    }
    if (!ownPrivate) {
      document.getElementById('g-body').innerHTML = '<p class="center">Chargement de ta main privée…</p>';
      document.getElementById('g-hand').innerHTML = '';
      document.getElementById('g-actions').innerHTML = '';
      go('p-game');
      return;
    }
    if (Number(ownPrivate.drawnRevision) !== Number(state.revision)) {
      prepareTurnCards();
      return;
    }
    G.drawn = Array.isArray(ownPrivate.drawn) ? ownPrivate.drawn : [];
    G.chosen = null;
    if (!G.drawn.length) {
      document.getElementById('g-body').innerHTML = '<p class="center">Préparation des cartes du tour…</p>';
    } else {
      let html = '<p style="margin-bottom:12px;"><b style="color:var(--gold2)">' +
        G.players[G.currentP].name + '</b> — Choisis une carte :</p>';
      G.drawn.forEach((c, i) => {
        html += '<div class="card pick ' + getTour().cls + '" onclick="pickCard(' + i + ')"><div class="card-top"></div>' +
          '<div class="cname">' + c.name + '</div>' +
          row('✅','lg','Bonus',c.bonus) + row('⛔','lr','Malus',c.malus) +
          row('🔗','lb','Association',c.assoc) + '</div>';
      });
      document.getElementById('g-body').innerHTML = html;
    }
    document.getElementById('g-actions').innerHTML =
      '<button class="btn btn-gold" id="btn-ok" onclick="confirmPick()" style="display:none;">Confirmer la carte ✓</button>';
    renderHand();
    document.getElementById('g-body').insertAdjacentHTML('beforeend', renderScoreboard());
    go('p-game');
  }

  async function prepareTurnCards() {
    if (preparingTurn || !state || state.currentPlayerUid !== v8User.uid) return;
    preparingTurn = true;
    try {
      const choices = pick3(TOUR_CARDS[tourNum()].cards);
      const saved = await mp.prepareOwnTurn(choices);
      ownPrivate = { ...(ownPrivate || {}), drawn: saved, drawnRevision: Number(state.revision) };
      G.drawn = saved;
      renderOnlineGame();
    } catch (err) {
      toast(firebaseFriendlyError(err), 'warn');
    } finally {
      preparingTurn = false;
    }
  }

  function makeNextState(nextUid) {
    const uids = uidList();
    const nextIndex = uids.indexOf(nextUid);
    return adapter.buildNextState(G, uids, nextIndex);
  }

  async function confirmOnlinePick() {
    if (!state || state.currentPlayerUid !== v8User.uid || submittingTurn) return;
    if (G.chosen === null || !G.drawn[G.chosen]) {
      toast('Choisis une carte de tour !', 'warn');
      return;
    }
    const selected = G.drawn[G.chosen];
    const currentIndex = ownIndex();
    const scoresBefore = G.players.map(p => ({ q:p.q, a:p.a, r:p.r }));
    submittingTurn = true;
    // Verrouiller immédiatement le bouton jusqu'à réception de la nouvelle révision Firestore.
    // Sans cette révision attendue, le finally pouvait réactiver l'écran avant le snapshot,
    // laissant le joueur retaper et provoquer une validation avec un état devenu obsolète.
    committingRevision = Number(state.revision) + 1;
    renderOnlineGame();
    G.allChosen.push({ player: currentIndex, card: selected });
    const uids = uidList();
    try {
      if (currentIndex < G.players.length - 1) {
        const nextState = makeNextState(uids[currentIndex + 1]);
        await mp.commitTurn(state.revision, nextState, {
          type: 'tour-card',
          cardName: selected.name,
          summary: G.players[currentIndex].name + ' a validé sa carte de tour.'
        });
        return;
      }

      // Le dernier joueur clôt le tour et applique les points une seule fois.
      G.players.forEach((p, pi) => {
        const choice = G.allChosen.find(x => x.player === pi);
        autoScoreBreakdown(p, choice).forEach(line => applyDelta(p, line.d));
      });

      if (tourAbsolu() === 7) {
        const finalState = makeNextState(v8User.uid);
        await mp.finish(state.revision, finalState, {
          type: 'finish',
          summary: 'Les huit tours sont terminés.'
        });
        return;
      }

      if (G.tourInSaison === 1) {
        G.saisonIdx += 1;
        G.tourInSaison = 0;
        G.meteo = rand(getSaison().meteos);
        const eventKey = ['hiver','printemps','ete','automne'][G.saisonIdx];
        G.evenement = EVENEMENTS[eventKey] ? rand(EVENEMENTS[eventKey]) : null;
      } else {
        G.tourInSaison += 1;
      }
      G.allChosen = [];
      const nextState = makeNextState(uids[0]);
      nextState.allChosen = [];
      await mp.commitTurn(state.revision, nextState, {
        type: 'round-complete',
        cardName: selected.name,
        summary: 'Tour terminé. Les scores ont été mis à jour.'
      });
      toast('Tour terminé ! Les scores sont mis à jour.');
    } catch (err) {
      // La transaction a échoué : restaurer le score local et relire l’état partagé.
      committingRevision = null;
      G.players.forEach((p, i) => Object.assign(p, scoresBefore[i]));
      G.allChosen = (state.allChosen || []).map(item => ({
        player: G.players.findIndex(p => p.uid === item.playerUid), card: item.card
      })).filter(item => item.player >= 0);
      toast(firebaseFriendlyError(err), 'warn');
    } finally {
      if (committingRevision === null) {
        submittingTurn = false;
        if (state && state.status === 'playing') renderOnlineGame();
      }
    }
  }

  async function playOnlineHandCard(type, cardIdx, srcIdx, tgtIdx) {
    if (!state || state.currentPlayerUid !== v8User.uid) {
      toast('Tu ne peux jouer une carte spéciale que pendant ton tour.', 'warn');
      return;
    }
    const source = G.players[srcIdx];
    const target = G.players[tgtIdx];
    const card = type === 'cdm' ? source.cdm[cardIdx] : source.mat[cardIdx];
    if (!card || card.played) return;
    const oldScores = G.players.map(p => ({ q:p.q, a:p.a, r:p.r }));
    try {
      if (card.appliquer) card.appliquer(source, target, G.meteo ? G.meteo.name : '');
      card.played = true;
      const nextState = makeNextState(v8User.uid);
      await mp.commitAction(state.revision, nextState, {
        type: 'special-card',
        specialCard: { type, name: card.name },
        summary: G.players[srcIdx].name + ' a joué une carte spéciale.'
      });
      closeModal();
      toast('Carte spéciale jouée !');
      renderHand();
    } catch (err) {
      G.players.forEach((p, i) => Object.assign(p, oldScores[i]));
      card.played = false;
      toast(firebaseFriendlyError(err), 'warn');
    }
  }

  function attachV9Listeners() {
    mp.configure(v8Db, v8RoomCode, v8User.uid);
    mp.listen({
      onPublic: applyPublic,
      onPrivate: applyPrivate
    });
    if (setupUnsub) setupUnsub();
    setupUnsub = mp.listenSetupPlayers(profiles => {
      setupProfiles = profiles;
      refreshLobby();
    });
    ensureLobbyControls();
  }

  attachOnlineRoom = function (code) {
    detachOnlineRoomListeners();
    v8RoomCode = code;
    state = null;
    ownPrivate = null;
    setupProfiles = [];
    members = [];
    localSetupPlayer = null;
    document.getElementById('online-room-code').textContent = code;
    go('p-online-lobby');
    ensureLobbyControls();

    const roomRef = v8Db.collection('rooms').doc(code);
    v8RoomUnsub = roomRef.onSnapshot(snap => {
      const msg = document.getElementById('v9-room-msg');
      if (!snap.exists) {
        if (msg) msg.textContent = 'Ce salon n’existe plus.';
        return;
      }
      const room = snap.data();
      if (msg) msg.textContent = room.status === 'waiting'
        ? 'En attente des joueurs. Prépare ton vigneron pour rejoindre la partie.'
        : 'La partie est en cours.';
    }, err => {
      const msg = document.getElementById('v9-room-msg');
      if (msg) msg.textContent = firebaseFriendlyError(err);
    });

    v8MembersUnsub = roomRef.collection('members').orderBy('joinedAt').onSnapshot(snapshot => {
      members = snapshot.docs.map(doc => doc.data());
      const hostEl = document.getElementById('online-members');
      hostEl.innerHTML = '';
      if (!members.length) {
        hostEl.innerHTML = '<p>Aucun joueur connecté.</p>';
      } else {
        members.forEach(member => {
          const line = document.createElement('div');
          line.className = 'online-member';
          const dot = document.createElement('span');
          dot.className = 'online-dot';
          const label = document.createElement('span');
          label.textContent = (member.name || 'Vigneron') + (member.role === 'host' ? ' — Hôte' : '');
          line.append(dot, label);
          hostEl.appendChild(line);
        });
        const count = document.createElement('p');
        count.className = 'online-code-note';
        count.textContent = members.length + ' / 4 joueur(s) connecté(s)';
        hostEl.appendChild(count);
      }
      refreshLobby();
    }, err => {
      document.getElementById('online-members').textContent = firebaseFriendlyError(err);
    });

    attachV9Listeners();
    ensureLobbyControls();
  };

  leaveOnlineRoom = async function () {
    if (state && state.status === 'playing' && state.players.some(player => player.uid === v8User.uid)) {
      toast('La partie est en cours. Pour ne pas bloquer les autres joueurs, ferme simplement cette page et reviens avec le même code.');
      return;
    }
    stopV9();
    state = null;
    ownPrivate = null;
    localSetupPlayer = null;
    return originalLeave();
  };

  function stopV9() {
    mp.stop();
    if (setupUnsub) setupUnsub();
    if (membersUnsub) membersUnsub();
    setupUnsub = null;
    membersUnsub = null;
  }

  checkSetup = function () {
    if (v8RoomCode && !state) return saveMyPreparation();
    return originalCheckSetup();
  };

  confirmPick = function () {
    if (online()) return confirmOnlinePick();
    return originalConfirmPick();
  };

  playHandCard = function (type, cardIdx, srcIdx, tgtIdx) {
    if (online()) return playOnlineHandCard(type, cardIdx, srcIdx, tgtIdx);
    return originalPlayHandCard(type, cardIdx, srcIdx, tgtIdx);
  };

  // Les écrans de fin sont rendus par le moteur V8 à partir des scores publics.
  endGame = function () {
    if (online()) return originalEndGame();
    return originalEndGame();
  };

  newGame = function () {
    if (state && state.status === 'finished') {
      stopV9();
      state = null;
      ownPrivate = null;
      localSetupPlayer = null;
      originalLeave().finally(() => originalNewGame());
      return;
    }
    return originalNewGame();
  };

  window.addEventListener('load', () => {
    const lobby = document.getElementById('p-online-lobby');
    if (lobby) ensureLobbyControls();
  });
})();

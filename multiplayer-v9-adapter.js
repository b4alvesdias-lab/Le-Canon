/* Le Canon V9 — adaptateur entre le moteur V8 et le modèle public/privé.
 * Aucun objet G complet ni aucune main ne doit être envoyé à Firestore.
 */
(function () {
  'use strict';

  const pick = (value, keys) => {
    if (!value || typeof value !== 'object') return null;
    const out = {};
    keys.forEach(key => {
      if (value[key] !== undefined && value[key] !== null) out[key] = value[key];
    });
    return out;
  };

  const api = {
    publicCard(card) {
      if (!card || typeof card.name !== 'string') throw new Error('Carte de tour invalide.');
      return pick(card, ['name', 'bonus', 'malus', 'assoc']);
    },

    publicProfile(player, uid) {
      if (!player || !uid || !player.name || !player.cepage || !player.terroir || !player.mode) {
        throw new Error('Profil joueur incomplet.');
      }
      const safeName = String(player.name).replace(/[<>]/g, '').replace(/[\\u0000-\\u001F]/g, '').trim().slice(0, 24) || 'Vigneron';
      return {
        uid: String(uid),
        name: safeName,
        cepage: pick(player.cepage, ['name', 'desc', 'bonus', 'malus', 'assoc']),
        terroir: pick(player.terroir, ['name', 'desc', 'bonus', 'malus', 'assoc']),
        mode: pick(player.mode, ['name', 'bonus', 'malus', 'assoc']),
        q: Math.max(0, Number(player.q) || 0),
        a: Math.max(0, Number(player.a) || 0),
        r: Math.max(0, Number(player.r) || 0)
      };
    },

    privatePayload(player, drawn) {
      if (!player || !Array.isArray(player.cdm) || !Array.isArray(player.mat)) {
        throw new Error('Main joueur invalide.');
      }
      const card = c => ({
        name: String(c.name || ''),
        type: String(c.type || ''),
        effet: String(c.effet || ''),
        played: c.played === true
      });
      return {
        hand: {
          cdm: player.cdm.map(card),
          mat: player.mat.map(card)
        },
        drawn: Array.isArray(drawn) ? drawn.map(c => this.publicCard(c)) : []
      };
    },

    buildInitialState(game, playerUids) {
      if (!game || !Array.isArray(game.players) || !Array.isArray(playerUids) ||
          game.players.length !== playerUids.length || playerUids.length < 2 || playerUids.length > 4) {
        throw new Error('La liste des joueurs en ligne est invalide.');
      }
      const players = game.players.map((p, i) => this.publicProfile(p, playerUids[i]));
      const first = players[0].uid;
      return {
        players,
        currentPlayerUid: first,
        saisonIdx: Number(game.saisonIdx) || 0,
        tourInSaison: Number(game.tourInSaison) || 0,
        meteo: pick(game.meteo, ['name', 'bonus', 'malus']),
        evenement: game.evenement ? pick(game.evenement, ['name', 'desc', 'effet', 'delta']) : null,
        allChosen: [],
        turnStatus: 'choosing'
      };
    },

    buildNextState(game, playerUids, nextPlayerIndex) {
      const state = this.buildInitialState(game, playerUids);
      state.players = game.players.map((p, i) => this.publicProfile(p, playerUids[i]));
      state.currentPlayerUid = playerUids[nextPlayerIndex];
      state.saisonIdx = Number(game.saisonIdx) || 0;
      state.tourInSaison = Number(game.tourInSaison) || 0;
      state.meteo = pick(game.meteo, ['name', 'bonus', 'malus']);
      state.evenement = game.evenement ? pick(game.evenement, ['name', 'desc', 'effet', 'delta']) : null;
      state.allChosen = (game.allChosen || []).map(item => ({
        playerUid: playerUids[item.player],
        card: this.publicCard(item.card)
      }));
      state.turnStatus = 'choosing';
      return state;
    },

    hydratePlayer(publicPlayer, privateData, catalog) {
      if (!publicPlayer || !privateData || !privateData.hand || !catalog) {
        throw new Error('Données du joueur incomplètes.');
      }
      const hydrate = (saved, definitions) => saved.map(card => {
        const def = definitions.find(d => d.name === card.name && d.type === card.type);
        if (!def) throw new Error('Carte introuvable dans le catalogue : ' + card.name);
        return { ...def, played: card.played === true };
      });
      return {
        ...publicPlayer,
        cdm: hydrate(privateData.hand.cdm || [], catalog.cdm),
        mat: hydrate(privateData.hand.mat || [], catalog.mat)
      };
    }
  };

  window.CanonMultiplayerV9Adapter = api;
})();

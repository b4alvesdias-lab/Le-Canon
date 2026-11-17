/* Le Canon V9 — synchronisation Firestore
 * Couche technique isolée du moteur de jeu V8.
 *
 * Collections :
 * rooms/{code}/game/state       état public de la partie
 * rooms/{code}/private/{uid}    main privée du joueur connecté
 * rooms/{code}/actions/{id}     journal public des actions
 *
 * Ce module ne rend PAS encore le jeu V8 multijoueur à lui seul.
 * Les règles Firestore doivent être adaptées et testées avant activation.
 */
(function () {
  'use strict';

  const api = {
    db: null,
    code: null,
    uid: null,
    unsubPublic: null,
    unsubPrivate: null,

    configure(db, roomCode, uid) {
      if (!db || !roomCode || !uid) throw new Error('Connexion V9 incomplète.');
      this.stop();
      this.db = db;
      this.code = String(roomCode).trim().toUpperCase();
      this.uid = uid;
    },

    roomRef() {
      if (!this.db || !this.code || !this.uid) {
        throw new Error('Synchronisation V9 non configurée.');
      }
      return this.db.collection('rooms').doc(this.code);
    },

    async assertMember() {
      const room = await this.roomRef().get();
      if (!room.exists) throw new Error('Ce salon n’existe plus.');
      const member = await this.roomRef().collection('members').doc(this.uid).get();
      if (!member.exists) throw new Error('Tu ne fais pas partie de ce salon.');
      return room.data();
    },

    // Les cartes V8 contiennent une fonction appliquer(), non sérialisable
    // par Firestore. On ne stocke que les champs descriptifs et l'état joué.
    serializeCard(card) {
      if (!card || typeof card !== 'object' || typeof card.name !== 'string' ||
          typeof card.type !== 'string') {
        throw new Error('Carte invalide : nom ou type manquant.');
      }
      return {
        name: card.name,
        type: card.type,
        effet: typeof card.effet === 'string' ? card.effet : '',
        played: card.played === true
      };
    },

    serializeHand(player) {
      if (!player || !Array.isArray(player.cdm) || !Array.isArray(player.mat)) {
        throw new Error('Main invalide : les cartes Coup de Main et Matériel sont requises.');
      }
      return {
        cdm: player.cdm.map(card => this.serializeCard(card)),
        mat: player.mat.map(card => this.serializeCard(card))
      };
    },

    hydrateHand(savedHand, cardCatalog) {
      if (!savedHand || !cardCatalog ||
          !Array.isArray(savedHand.cdm) || !Array.isArray(savedHand.mat) ||
          !Array.isArray(cardCatalog.cdm) || !Array.isArray(cardCatalog.mat)) {
        throw new Error('Impossible de reconstituer cette main.');
      }
      const hydrateGroup = (savedCards, definitions) => savedCards.map(saved => {
        const definition = definitions.find(card =>
          card.name === saved.name && card.type === saved.type
        );
        if (!definition) throw new Error('Carte inconnue dans la main : ' + saved.name);
        return { ...definition, played: saved.played === true };
      });
      return {
        cdm: hydrateGroup(savedHand.cdm, cardCatalog.cdm),
        mat: hydrateGroup(savedHand.mat, cardCatalog.mat)
      };
    },

    assertPublicData(value, path) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const normalized = key.toLowerCase().replace(/[_-]/g, '');
        if (['hand', 'privatehand', 'privatecards', 'cdm', 'mat', 'drawn', 'drawncards', 'options', 'selectedhandcard'].includes(normalized)) {
          throw new Error('Une donnée privée ne peut pas être enregistrée dans l’état public.');
        }
        if (child && typeof child === 'object') {
          this.assertPublicData(child, path ? path + '.' + key : key);
        }
      }
    },

    async createGame(publicState, privateHand) {
      const roomRef = this.roomRef();
      const stateRef = roomRef.collection('game').doc('state');
      const privateRef = roomRef.collection('private').doc(this.uid);
      const state = publicState || {};
      this.assertPublicData(state, 'state');

      await this.db.runTransaction(async tx => {
        const roomSnap = await tx.get(roomRef);
        const memberSnap = await tx.get(roomRef.collection('members').doc(this.uid));
        const stateSnap = await tx.get(stateRef);
        if (!roomSnap.exists || !memberSnap.exists) {
          throw new Error('Tu ne fais pas partie de ce salon.');
        }
        if (roomSnap.data().hostUid !== this.uid) {
          throw new Error('Seul l’hôte peut lancer la partie.');
        }
        if (stateSnap.exists) throw new Error('Une partie existe déjà dans ce salon.');
        const playerUids = Array.isArray(state.players)
          ? state.players.map(player => player && player.uid).filter(Boolean)
          : [];
        if (playerUids.length < 2 || playerUids.length > 4 ||
            new Set(playerUids).size !== playerUids.length) {
          throw new Error('La partie doit contenir 2 à 4 joueurs distincts.');
        }
        if (!playerUids.includes(this.uid)) {
          throw new Error('L’hôte doit figurer parmi les joueurs.');
        }
        const memberSnaps = [];
        for (const playerUid of playerUids) {
          memberSnaps.push(await tx.get(roomRef.collection('members').doc(playerUid)));
        }
        if (memberSnaps.some(snap => !snap.exists)) {
          throw new Error('Tous les joueurs doivent avoir rejoint le salon avant le lancement.');
        }
        const setupSnaps = [];
        for (const playerUid of playerUids) {
          setupSnaps.push(await tx.get(roomRef.collection('game').doc('players').collection('items').doc(playerUid)));
        }
        if (setupSnaps.some(snap => !snap.exists || snap.data().ready !== true)) {
          throw new Error('Chaque joueur doit avoir terminé sa préparation sur son téléphone.');
        }
        const firstUid = state.currentPlayerUid || this.uid;
        if (!playerUids.includes(firstUid)) {
          throw new Error('Le premier joueur est invalide.');
        }
        tx.set(stateRef, {
          ...state,
          schemaVersion: 9,
          status: 'playing',
          revision: 1,
          currentPlayerUid: firstUid,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        tx.set(privateRef, {
          uid: this.uid,
          hand: privateHand ? this.serializeHand(privateHand) : { cdm: [], mat: [] },
          drawn: [],
          drawnRevision: -1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
    },

    listen(handlers) {
      const room = this.roomRef();
      const onPublic = handlers && handlers.onPublic;
      const onPrivate = handlers && handlers.onPrivate;
      this.stop();
      this.unsubPublic = room.collection('game').doc('state').onSnapshot(
        snap => {
          if (snap.exists && typeof onPublic === 'function') onPublic(snap.data());
        },
        err => console.error('[Canon V9] état public', err)
      );
      // L’UID est celui de cet appareil : aucun abonnement aux mains adverses.
      this.unsubPrivate = room.collection('private').doc(this.uid).onSnapshot(
        snap => {
          if (snap.exists && typeof onPrivate === 'function') onPrivate(snap.data());
        },
        err => console.error('[Canon V9] main privée', err)
      );
    },

    async saveOwnSetup(publicProfile, privateHand) {
      const roomRef = this.roomRef();
      const profile = publicProfile || {};
      this.assertPublicData(profile, 'player');
      if (!profile.uid || profile.uid !== this.uid) {
        throw new Error('Le profil doit correspondre au joueur connecté.');
      }
      await this.assertMember();
      await roomRef.collection('game').doc('players').collection('items').doc(this.uid).set({
        ...profile,
        uid: this.uid,
        ready: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await roomRef.collection('private').doc(this.uid).set({
        uid: this.uid,
        hand: privateHand ? this.serializeHand(privateHand) : { cdm: [], mat: [] },
        drawn: [],
        drawnRevision: -1,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    },

    listenSetupPlayers(callback) {
      const ref = this.roomRef().collection('game').doc('players').collection('items');
      return ref.onSnapshot(snapshot => {
        if (typeof callback === 'function') {
          callback(snapshot.docs.map(doc => doc.data()));
        }
      }, err => console.error('[Canon V9] préparations joueurs', err));
    },

    async prepareOwnTurn(drawnCards) {
      const roomRef = this.roomRef();
      const stateRef = roomRef.collection('game').doc('state');
      const privateRef = roomRef.collection('private').doc(this.uid);
      const proposed = Array.isArray(drawnCards) ? drawnCards.map(card => this.serializeTurnCard(card)) : [];
      return this.db.runTransaction(async tx => {
        const stateSnap = await tx.get(stateRef);
        const privateSnap = await tx.get(privateRef);
        if (!stateSnap.exists || !privateSnap.exists) throw new Error('Partie ou main introuvable.');
        const state = stateSnap.data();
        if (state.status !== 'playing' || state.currentPlayerUid !== this.uid) {
          throw new Error('Ce n’est pas ton tour.');
        }
        const revision = Number(state.revision);
        const saved = privateSnap.data();
        if (Number(saved.drawnRevision) === revision && Array.isArray(saved.drawn)) {
          return saved.drawn;
        }
        tx.set(privateRef, {
          drawn: proposed,
          drawnRevision: revision,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return proposed;
      });
    },

    serializeTurnCard(card) {
      if (!card || typeof card.name !== 'string') throw new Error('Carte de tour invalide.');
      return {
        name: card.name,
        bonus: typeof card.bonus === 'string' ? card.bonus : '',
        malus: typeof card.malus === 'string' ? card.malus : '',
        assoc: typeof card.assoc === 'string' ? card.assoc : ''
      };
    },

    async updateOwnHand(hand) {
      await this.assertMember();
      const ref = this.roomRef().collection('private').doc(this.uid);
      await ref.set({
        uid: this.uid,
        hand: hand ? this.serializeHand(hand) : { cdm: [], mat: [] },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    },

    async commitAction(expectedRevision, nextPublicState, action) {
      const roomRef = this.roomRef();
      const stateRef = roomRef.collection('game').doc('state');
      const privateRef = roomRef.collection('private').doc(this.uid);
      const actionRef = roomRef.collection('actions').doc();
      const nextState = nextPublicState || {};
      this.assertPublicData(nextState, 'state');

      return this.db.runTransaction(async tx => {
        const roomSnap = await tx.get(roomRef);
        const memberSnap = await tx.get(roomRef.collection('members').doc(this.uid));
        const stateSnap = await tx.get(stateRef);
        const privateSnap = await tx.get(privateRef);
        if (!roomSnap.exists || !memberSnap.exists || !stateSnap.exists || !privateSnap.exists) {
          throw new Error('Partie, joueur ou main introuvable.');
        }
        const current = stateSnap.data();
        if (current.status !== 'playing' || current.currentPlayerUid !== this.uid) {
          throw new Error('Ce n’est pas ton tour.');
        }
        if (Number(current.revision) !== Number(expectedRevision)) {
          throw new Error('La partie a changé sur un autre téléphone. Actualise et réessaie.');
        }
        if (nextState.currentPlayerUid !== this.uid) {
          throw new Error('Une action spéciale ne doit pas changer le joueur actif.');
        }
        const privateData = privateSnap.data();
        const special = action && action.specialCard;
        if (special) {
          const group = special.type === 'cdm' ? 'cdm' : special.type === 'mat' ? 'mat' : null;
          if (!group) throw new Error('Type de carte spéciale invalide.');
          const cards = privateData.hand && Array.isArray(privateData.hand[group]) ? privateData.hand[group] : [];
          const card = cards.find(item => item.name === special.name && item.played !== true);
          if (!card) throw new Error('Cette carte spéciale est absente ou déjà jouée.');
          card.played = true;
          tx.set(privateRef, {
            hand: privateData.hand,
            drawn: privateData.drawn || [],
            drawnRevision: Number(current.revision) + 1,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
        tx.update(stateRef, {
          ...nextState,
          schemaVersion: 9,
          status: 'playing',
          revision: Number(current.revision) + 1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        tx.set(actionRef, {
          by: this.uid,
          type: String(action && action.type || 'action').slice(0, 40),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          summary: String(action && action.summary || '').slice(0, 160)
        });
        return Number(current.revision) + 1;
      });
    },

    async commitTurn(expectedRevision, nextPublicState, action) {
      const roomRef = this.roomRef();
      const stateRef = roomRef.collection('game').doc('state');
      const actionRef = roomRef.collection('actions').doc();
      const nextState = nextPublicState || {};
      this.assertPublicData(nextState, 'state');

      return this.db.runTransaction(async tx => {
        const roomSnap = await tx.get(roomRef);
        const memberSnap = await tx.get(roomRef.collection('members').doc(this.uid));
        const snap = await tx.get(stateRef);
        if (!roomSnap.exists || !memberSnap.exists) {
          throw new Error('Tu ne fais plus partie de ce salon.');
        }
        if (!snap.exists) throw new Error('La partie en ligne n’a pas été initialisée.');
        const current = snap.data();
        const privateRef = roomRef.collection('private').doc(this.uid);
        const privateSnap = await tx.get(privateRef);
        if (!privateSnap.exists) throw new Error('Main privée introuvable.');
        if (current.status !== 'playing') throw new Error('La partie n’est pas en cours.');
        if (current.currentPlayerUid !== this.uid) throw new Error('Ce n’est pas ton tour.');
        if (Number(current.revision) !== Number(expectedRevision)) {
          throw new Error('La partie a changé sur un autre téléphone. Actualise et réessaie.');
        }
        const playerUids = Array.isArray(nextState.players)
          ? nextState.players.map(player => player && player.uid).filter(Boolean)
          : [];
        const nextUid = nextState.currentPlayerUid;
        if (action && action.cardName) {
          const ownPrivate = privateSnap.data();
          const options = Array.isArray(ownPrivate.drawn) ? ownPrivate.drawn : [];
          if (Number(ownPrivate.drawnRevision) !== Number(current.revision) ||
              !options.some(card => card.name === action.cardName)) {
            throw new Error('Cette carte ne fait pas partie de tes propositions pour ce tour.');
          }
        }
        if (!nextUid || !playerUids.includes(nextUid)) {
          throw new Error('Le prochain joueur est invalide.');
        }
        const nextMember = await tx.get(roomRef.collection('members').doc(nextUid));
        if (!nextMember.exists) throw new Error('Le prochain joueur ne fait plus partie du salon.');

        tx.update(stateRef, {
          ...nextState,
          schemaVersion: 9,
          status: 'playing',
          revision: Number(current.revision) + 1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        tx.set(privateRef, {
          drawn: [],
          drawnRevision: -1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        tx.set(actionRef, {
          by: this.uid,
          type: String(action && action.type || 'turn').slice(0, 40),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          summary: String(action && action.summary || '').slice(0, 160)
        });
        return Number(current.revision) + 1;
      });
    },

    async finish(expectedRevision, finalPublicState, action) {
      const roomRef = this.roomRef();
      const stateRef = roomRef.collection('game').doc('state');
      const actionRef = roomRef.collection('actions').doc();
      const finalState = finalPublicState || {};
      this.assertPublicData(finalState, 'state');

      return this.db.runTransaction(async tx => {
        const memberSnap = await tx.get(roomRef.collection('members').doc(this.uid));
        const snap = await tx.get(stateRef);
        if (!memberSnap.exists || !snap.exists) throw new Error('Partie ou joueur introuvable.');
        const current = snap.data();
        if (current.status !== 'playing' || current.currentPlayerUid !== this.uid) {
          throw new Error('Seul le joueur dont c’est le tour peut terminer la partie.');
        }
        if (Number(current.revision) !== Number(expectedRevision)) {
          throw new Error('La partie a changé sur un autre téléphone. Actualise et réessaie.');
        }
        tx.update(stateRef, {
          ...finalState,
          schemaVersion: 9,
          status: 'finished',
          revision: Number(current.revision) + 1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        tx.set(actionRef, {
          by: this.uid,
          type: String(action && action.type || 'finish').slice(0, 40),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          summary: String(action && action.summary || 'Fin de partie').slice(0, 160)
        });
        return Number(current.revision) + 1;
      });
    },

    stop() {
      if (this.unsubPublic) this.unsubPublic();
      if (this.unsubPrivate) this.unsubPrivate();
      this.unsubPublic = null;
      this.unsubPrivate = null;
    }
  };

  window.CanonMultiplayerV9 = api;
})();

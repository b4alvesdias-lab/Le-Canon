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

    assertPublicData(value, path) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const normalized = key.toLowerCase().replace(/[_-]/g, '');
        if (['hand', 'privatehand', 'privatecards', 'cdm', 'mat'].includes(normalized)) {
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
          hand: privateHand || {},
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
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

    async updateOwnHand(hand) {
      await this.assertMember();
      const ref = this.roomRef().collection('private').doc(this.uid);
      await ref.set({
        uid: this.uid,
        hand: hand || {},
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
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
        if (current.status !== 'playing') throw new Error('La partie n’est pas en cours.');
        if (current.currentPlayerUid !== this.uid) throw new Error('Ce n’est pas ton tour.');
        if (Number(current.revision) !== Number(expectedRevision)) {
          throw new Error('La partie a changé sur un autre téléphone. Actualise et réessaie.');
        }
        const playerUids = Array.isArray(nextState.players)
          ? nextState.players.map(player => player && player.uid).filter(Boolean)
          : [];
        const nextUid = nextState.currentPlayerUid;
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

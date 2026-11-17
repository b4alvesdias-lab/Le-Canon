# Le Canon V9 — plan d’intégration au moteur V8

## État vérifié sur la branche `v9-multijoueur`

Le moteur V8 est encore un moteur local :
- `G.players` contient les joueurs de la partie sur un seul appareil ;
- `goSetup()` distribue les cartes de départ à tous les joueurs du même appareil ;
- `beginSaison()` tire la météo et l’événement sur cet appareil ;
- `drawForCurrentPlayer()` tire trois cartes de tour et les affiche au joueur actif ;
- `confirmPick()` passe au joueur suivant localement ;
- `goScores()` calcule les points de tous les joueurs localement ;
- `nextTour()` fait avancer la saison et les huit tours.

Le salon V8 ne synchronise actuellement que la salle et la liste des membres. Le module V9 ne doit donc pas être considéré comme une partie jouable.

## Contrat de données proposé

### État public : `rooms/{code}/game/state`

Contient uniquement ce que tous les joueurs peuvent voir :
- version du schéma, statut et numéro de révision ;
- liste des joueurs avec `uid`, nom, cépage, terroir, mode et scores ;
- identifiant du joueur dont c’est le tour ;
- saison, tour, météo et événement ;
- choix déjà validés et historique public des actions.

Ne jamais y enregistrer les mains, les cartes spéciales non jouées, ni les trois cartes de tour proposées au joueur actif.

### Données privées : `rooms/{code}/private/{uid}`

Chaque joueur lit uniquement son propre document :
- ses cartes Coup de Main ;
- ses cartes Matériel ;
- ses trois cartes de tour proposées ;
- l’état de sélection local nécessaire à son tour.

Un joueur ne doit jamais lire la collection privée entière ni les documents privés des autres UID.

### Journal : `rooms/{code}/actions/{actionId}`

Conserve un résumé public et non sensible de chaque action validée. Aucun contenu de main ou carte secrète.

## Ordre d’intégration

1. Terminer le contrat Firestore et tester les droits de lecture/écriture avec deux comptes anonymes.
2. Ajouter au salon un bouton de lancement réservé à l’hôte ; attendre que les joueurs soient présents.
3. Faire choisir à chaque joueur son mode et ses cartes de départ sur son propre téléphone.
4. Faire initialiser l’état public par l’hôte et écrire chaque main par son propriétaire.
5. Adapter la distribution des trois cartes de tour pour qu’elles restent dans le document privé du joueur actif.
6. Remplacer le passage local de joueur par une validation Firestore avec révision, puis afficher l’écran du joueur suivant sur son téléphone.
7. Synchroniser les scores et la fin de partie.
8. Tester les déconnexions, retours en arrière, doubles clics et conflits de tour sur deux téléphones avant de publier.

## Limites de sécurité

Les transactions client et les règles Firestore peuvent empêcher les accès privés et les écritures hors tour, mais elles ne suffisent pas à garantir qu’un client modifié n’envoie jamais un score falsifié. Pour un jeu public compétitif, les actions et calculs de score devront être validés par un backend de confiance (par exemple Cloud Functions). Ne pas publier le brouillon de règles comme protection anti-triche complète.

## Protection de la version stable

Cette intégration reste sur `v9-multijoueur`. Ne pas fusionner vers `main`, ni changer la source GitHub Pages, avant les tests réels. Le site public reste sur la V8.

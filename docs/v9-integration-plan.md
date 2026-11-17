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

Le salon V8 ne synchronise que la salle et la liste des membres. Le contrôleur V9 raccorde maintenant le moteur et une partie complète à deux navigateurs a été jouée automatiquement avec les émulateurs Firebase.

## Contrat de données proposé

### État public : `rooms/{code}/game/state`

Contient uniquement ce que tous les joueurs peuvent voir :
- version du schéma, statut et numéro de révision ;
- liste des joueurs avec `uid`, nom, cépage, terroir, mode et scores ;
- identifiant du joueur dont c’est le tour ;
- saison, tour, météo et événement ;
- choix déjà validés et historique public des actions.

Ne jamais y enregistrer les mains, les cartes spéciales non jouées, ni les trois cartes de tour proposées au joueur actif.

### Profils de préparation : `rooms/{code}/game/players/items/{uid}`

Chaque joueur écrit depuis son propre téléphone son profil public (`uid`, nom, cépage, terroir, mode, scores initiaux et `ready`). L’hôte ne peut initialiser la partie que si chaque joueur présent dans la partie a publié son profil prêt.

### Données privées : `rooms/{code}/private/{uid}`

Chaque joueur lit uniquement son propre document :
- ses cartes Coup de Main ;
- ses cartes Matériel ;
- ses trois cartes de tour proposées, avec `drawnRevision` pour éviter de retirer de nouvelles cartes après un rafraîchissement ;
- l’état de sélection local nécessaire à son tour.

Un joueur ne doit jamais lire la collection privée entière ni les documents privés des autres UID.

### Journal : `rooms/{code}/actions/{actionId}`

Conserve un résumé public et non sensible de chaque action validée. Aucun contenu de main ou carte secrète.

## Avancement technique

Les fichiers `multiplayer-v9.js` et `multiplayer-v9-adapter.js` contiennent désormais les fonctions de base suivantes :
- enregistrement du profil public et de la main privée par le joueur connecté (`saveOwnSetup`) ;
- écoute des profils de préparation (`listenSetupPlayers`) ;
- refus du lancement si un joueur n’a pas publié son profil prêt ;
- génération persistante des cartes proposées pour une révision (`prepareOwnTurn`) ;
- conversion explicite des profils, cartes, états publics et paquets privés du moteur V8.

Le contrôleur `multiplayer-v9-controller.js` et la page isolée `v9.html` raccordent le salon, les préparations, les tours, les cartes spéciales et les scores. Le test Playwright a validé deux sessions distinctes, les huit tours et l’écran final. `index.html` n’a pas été modifié. Il reste à fusionner les règles dans le vrai projet Firebase et à tester sur deux téléphones.

## Ordre d’intégration restant

1. Fusionner `FIRESTORE_V9_MERGE_FRAGMENT.txt` dans les règles V8 actives, sans copier les règles racine simplifiées du fichier d’émulateur.
2. Tester la création/rejoint de salon sur le vrai projet Firebase `le-canon` avec deux téléphones.
3. Tester les rafraîchissements, retours arrière, doubles clics, déconnexions et reconnexions.
4. Après validation, fusionner la branche V9 vers `main` et publier `v9.html` sans perdre l’accès à la V8.

## Limites de sécurité

Les transactions client et les règles Firestore peuvent empêcher les accès privés et les écritures hors tour, mais elles ne suffisent pas à garantir qu’un client modifié n’envoie jamais un score falsifié. Pour un jeu public compétitif, les actions et calculs de score devront être validés par un backend de confiance (par exemple Cloud Functions). Ne pas publier le brouillon de règles comme protection anti-triche complète.

## Protection de la version stable

Cette intégration reste sur `v9-multijoueur`. Ne pas fusionner vers `main`, ni changer la source GitHub Pages, avant les tests réels. Le site public reste sur la V8.

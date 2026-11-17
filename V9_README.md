# Le Canon V9 — architecture multijoueur

Cette branche est la base de travail V9. La V8 sur `main` reste intacte.

## Principe de confidentialité
- `rooms/{code}/public/state` : état partagé (phase, saison, tour, météo, événement, scores, ordre de jeu et choix déjà révélés).
- `rooms/{code}/privateHands/{uid}` : cartes privées de ce joueur uniquement.
- `rooms/{code}/actions/{actionId}` : intentions/actions envoyées par les joueurs.
- `rooms/{code}/members/{uid}` : présence, pseudo et statut prêt.

Les cartes privées ne doivent jamais être copiées dans le document public, dans la liste des membres, ni dans les journaux affichés à tous.

## Autorité de partie
L'hôte orchestre les transitions et publie l'état commun. Les joueurs envoient leurs actions; le serveur/hôte valide que l'action correspond au joueur actif avant de publier son résultat. Les règles Firestore limitent la lecture des mains à leur propriétaire.

## Sécurité
Le fichier `FIRESTORE_RULES_V9.txt` contient une proposition de règles Firestore à auditer et à publier uniquement avec le code V9 compatible. Ne pas les publier pendant que la V8 est encore utilisée : les chemins et permissions ne sont pas rétrocompatibles.

## État
- V8 : création et accès aux salons vérifiés sur deux téléphones.
- V9 : branche et architecture de confidentialité créées.
- Le moteur complet (configuration, tours, cartes spéciales, scores, reconnexion et fin de partie) reste à intégrer et à tester sur deux appareils avant publication.

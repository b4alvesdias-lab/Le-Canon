# Passage V8 → V9 sur le vrai projet Firebase

La partie V9 a été testée de bout en bout avec deux navigateurs et les émulateurs Firebase. Le projet Firebase réel n’a pas encore été modifié.

## Règle essentielle

**Ne publie jamais `firestore.v9.rules` en remplacement complet des règles actuellement actives.** Ce fichier contient des règles racine `rooms` et `members` simplifiées, créées uniquement pour les tests automatisés.

Le fichier à fusionner est `FIRESTORE_V9_MERGE_FRAGMENT.txt`. Il contient :
- les fonctions d’aide préfixées `v9` ;
- les règles des nouveaux chemins V9 : `game/state`, `game/players/items`, `private` et `actions` ;
- aucune règle de remplacement pour la création, la lecture ou la suppression des salons V8.

## Procédure dans Firebase Console

1. Ouvre le projet Firebase **le-canon**.
2. Va dans **Firestore Database → Règles**.
3. Copie les règles actuellement publiées dans une sauvegarde avant toute modification.
4. Ouvre `FIRESTORE_V9_MERGE_FRAGMENT.txt` dans GitHub.
5. Dans le ruleset actif, conserve intégralement les règles V8 qui gèrent `rooms` et `members`.
6. Ajoute les fonctions `v9...` du fragment à l’intérieur de `match /databases/{database}/documents`, puis ajoute les quatre blocs `match` V9 au même niveau que les blocs V8.
7. Ne copie pas le bloc de test racine `rooms/{roomId}` / `members` de `firestore.v9.rules`.
8. Vérifie que Firebase accepte la syntaxe, puis publie les règles fusionnées.

En cas d’erreur, restaure la sauvegarde V8. Ne laisse pas le projet avec un ruleset partiellement copié.

## Test réel à deux téléphones

Après publication des règles fusionnées et mise en ligne de la page V9 :
1. Un téléphone crée un salon.
2. Le second rejoint avec le code.
3. Chaque joueur prépare son vigneron et choisit son mode.
4. L’hôte lance la partie.
5. Vérifie que seul le joueur actif voit ses trois cartes proposées et sa main spéciale.
6. Jouez les huit tours et vérifiez les scores et le podium sur les deux téléphones.
7. Recharge une page pendant une partie, puis vérifie la reconnexion au même salon.

## Ce qui reste volontairement séparé

- `main` et `index.html` restent sur V8.
- `v9.html` est la page de test V9 sur la branche `v9-multijoueur`.
- La publication de V9 sur GitHub Pages et le changement de page d’accueil ne doivent intervenir qu’après la fusion des règles et les tests réels.
- Les règles client protègent la confidentialité des mains et les tours normaux, mais ne constituent pas une protection anti-triche complète des scores contre un client modifié. Un backend de confiance serait nécessaire pour un jeu compétitif public.

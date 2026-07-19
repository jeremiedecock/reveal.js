# Déploiement des slides sur GitHub Pages (préversions par branche)

Ce document explique comment les slides sont publiés en ligne, pourquoi le déploiement
fonctionne ainsi, et les réglages GitHub nécessaires. Le workflow concerné est
[`.github/workflows/deploy-slides.yml`](.github/workflows/deploy-slides.yml).

## Objectif

Pouvoir relire en ligne — par exemple depuis une tablette, sans IDE ni Claude Code CLI —
le travail effectué par Claude Code Web sur une branche, **avant** de la merger dans
`master`. Claude Code Web travaille toujours dans une branche dédiée ; chaque branche du
repo est donc publiée dans son propre répertoire du site GitHub Pages :

| Branche       | URL                                                        |
|---------------|------------------------------------------------------------|
| `master`      | `https://jdhp-agents.github.io/reveal.js/index.html`       |
| `foo`         | `https://jdhp-agents.github.io/reveal.js/br/foo/index.html` |
| `claude/xyz`  | `https://jdhp-agents.github.io/reveal.js/br/claude/xyz/index.html` |

Le préfixe `br/` garantit qu'un répertoire de branche ne peut jamais entrer en collision
avec le contenu de `master` à la racine du site (par exemple une branche qui s'appellerait
`dist` ou `assets`).

Le site ne contient que les branches **encore existantes** : quand une branche est
supprimée sur GitHub (typiquement après un merge), son répertoire est retiré du site au
déploiement suivant — et la suppression déclenche elle-même un déploiement immédiat.

Cela fonctionne sans réécriture de chemins parce que `scripts/build-decks.mjs` produit un
site en URLs **entièrement relatives** : un deck se rend à l'identique à la racine du site
ou sous un sous-répertoire `<branche>/`.

## Comment ça marche (déploiement incrémental via la branche `gh-pages`)

Le site publié vit dans la branche orpheline **`gh-pages`** (créée automatiquement au
premier run du workflow), et GitHub Pages est configuré pour servir cette branche. À
chaque push sur une branche quelconque, le workflow :

1. **ne construit que la branche pushée** (`npm ci` + `npm run build:decks`, comme en
   local) — les autres branches ne sont pas reconstruites, leur contenu déjà publié est
   conservé tel quel ;
2. récupère `gh-pages`, remplace **uniquement** la partie du site appartenant à la
   branche pushée : la racine pour `master`, le répertoire `br/<branche>/` pour les
   autres ;
3. **élague** les répertoires des branches qui n'existent plus sur le repo (l'événement
   `delete` déclenche aussi le workflow, donc l'élagage est immédiat) ;
4. commite et pousse `gh-pages` ;
5. **vérifie que GitHub Pages est bien activé** sur la branche `gh-pages`, et l'active ou
   le reconfigure via l'API sinon (voir « Réglages GitHub » ci-dessous).

Détails d'implémentation utiles à connaître :

- Tout ce qui se trouve à la racine du site hors `br/` et les fichiers de service
  appartient au déploiement de `master` : un redéploiement de `master` remplace donc la
  racine en bloc sans toucher à `br/`. Un fichier manifeste caché à la racine de
  `gh-pages`, `.branches-manifest`, liste les branches actuellement publiées, pour que
  l'élagage sache quels sous-répertoires de `br/` supprimer (`br/` lui-même est retiré
  quand il devient vide).
- **L'historique de `gh-pages` est maintenu à un seul commit** (amend + force-push à
  chaque déploiement) : les gros médias de `assets/` (~270 Mo) ne s'accumulent pas dans
  l'historique du repo à chaque push.
- Un fichier **`.nojekyll`** est déposé à la racine : sans lui, GitHub Pages passe le
  site dans Jekyll, qui **ignore les chemins commençant par `_`** — or les figures d3
  compilées partagent leur code dans `assets/_shared/`.
- Git déduplique les blobs identiques entre répertoires de branches : publier 3 branches
  quasi identiques ne stocke les ~270 Mo d'`assets/` qu'une seule fois dans `gh-pages`.
- **Les decks archivés ne sont jamais publiés** : les présentations retirées vivent dans
  `archives/` (avec leurs médias dans `archives/assets/<deck>/` et leurs chapitres dans
  `archives/decks/<deck>/`) pour rester consultables via le serveur de dev, mais rien
  d'`archives/` n'entre dans `_site/` — `build-decks.mjs` n'assemble que les `*.html` de
  la racine et la compilation/type-check ne couvre que `assets/**/*.ts`. La liste
  « Archives » de `index.html` est balisée `<!-- @dev-only -->`…`<!-- @end-dev-only -->`
  et retirée à la publication (ses liens seraient morts en ligne), et le workflow ignore
  les pushes qui ne modifient que `archives/**` (`paths-ignore`), pour ne pas payer un
  build qui ne peut rien changer au site.

## Réglages GitHub

**Aucun réglage manuel n'est nécessaire.** Pousser sur `gh-pages` ne publie quelque chose
que si le site Pages du dépôt est activé et configuré en « Deploy from a branch » sur
cette branche ; c'était à l'origine un réglage manuel « une seule fois », jamais appliqué
sur ce dépôt — tous les runs se terminaient donc en succès alors que rien n'était jamais
mis en ligne (symptôme : aucun run « pages build and deployment » dans l'onglet Actions,
c'est le workflow interne que GitHub déclenche à chaque push sur la branche servie). La
dernière étape du workflow impose désormais cette configuration à chaque run via l'API
Pages : elle active le site s'il ne l'est pas (cas d'un dépôt/fork neuf) et repointe la
source si elle a changé (par exemple l'ancienne configuration « Source : GitHub
Actions » — voir l'historique plus bas).

Si cet appel API venait à être refusé, le run échoue avec un message explicite ; le
réglage manuel équivalent est **Settings → Pages → Build and deployment → Source :
« Deploy from a branch », Branch : `gh-pages` / `(root)`** (la branche `gh-pages` doit
exister pour apparaître dans le menu : elle est créée par le premier run du workflow).

L'ancienne recommandation de mettre l'environnement `github-pages` en « No restriction »
n'est plus nécessaire avec cette approche (le workflow n'utilise plus d'environnement de
déploiement, seulement les permissions `contents: write` et `pages: write` qu'il déclare
lui-même).

## Points d'attention

- **Branches créées avant ce workflow** : un push déclenche la version du workflow
  présente *sur la branche pushée*. Une branche partie d'un `master` antérieur à ce
  changement ne se publiera donc pas d'elle-même ; elle sera prise en compte à son
  prochain rebase, ou publiée manuellement (Actions → Run workflow en choisissant la
  branche). Les branches que Claude Code Web crée après le merge de ce changement
  embarquent le workflow et se publient toutes seules.
- **Branche au build cassé** : son run échoue et le site conserve la version
  précédente ; les autres branches ne sont pas affectées (chacune se déploie dans son
  propre run).
- **Resynchronisation complète** si `gh-pages` est corrompue : supprimer la branche
  `gh-pages` sur GitHub, puis relancer le workflow sur `master` et sur chaque branche à
  republier (Actions → Run workflow).
- **Taille du site** : GitHub Pages a une limite souple d'environ 1 Go *pour le site
  servi* ; chaque branche publiée pèse ~275 Mo côté site servi (la déduplication git ne
  joue que sur le stockage de la branche `gh-pages`). Supprimer les branches après merge
  (ce que Claude Code Web propose) suffit à rester loin de la limite.

## Historique du choix (pourquoi cette approche)

1. **Version d'origine** : source Pages « GitHub Actions », déploiement de `master`
   seulement à chaque push sur `master`.
2. **Première approche multi-branches (abandonnée)** : garder la source « GitHub
   Actions » et, à chaque push sur n'importe quelle branche, reconstruire *toutes* les
   branches dans un seul artefact (master à la racine, les autres en sous-répertoires).
   Simple et auto-nettoyante (la liste des branches était ré-énumérée à chaque run),
   mais chaque push payait la reconstruction de toutes les branches (~quelques minutes
   chacune), et l'artefact dupliquait les ~270 Mo d'assets par branche. Une
   parallélisation par matrix de jobs aurait réduit le temps horloge, pas le travail
   total.
3. **Approche actuelle (incrémentale)** : la source Pages « GitHub Actions » remplaçant
   le site *entier* à chaque déploiement, être incrémental impose de faire vivre le site
   dans une branche `gh-pages` et de repointer la source Pages dessus. Chaque push ne
   construit que sa branche, l'élagage garde le site aligné sur les branches existantes,
   et l'historique à commit unique borne la taille du repo.

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
premier run du workflow), qui sert de stockage incrémental entre les runs ; sa mise en
ligne dépend de la source Pages configurée (voir « Réglages GitHub » plus bas). À
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
5. **publie** : si la source Pages du dépôt est « Deploy from a branch » (`gh-pages`),
   le push précédent suffit (GitHub reconstruit le site tout seul) ; sinon — cas de la
   source « GitHub Actions », réglage actuel du dépôt — le workflow téléverse le site
   assemblé comme artefact Pages et le déploie explicitement (voir « Réglages GitHub »
   ci-dessous).

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

**Aucun réglage n'est nécessaire dans le cas général** : le workflow lit la source Pages
du dépôt (Settings → Pages → Build and deployment → Source) à chaque run et s'y adapte —

- **« GitHub Actions »** (réglage actuel du dépôt) : rien ne surveille la branche
  `gh-pages`, le workflow téléverse donc le site assemblé comme artefact Pages et le
  déploie explicitement (`actions/upload-pages-artifact` + `actions/deploy-pages`) ;
- **« Deploy from a branch », `gh-pages` / `(root)`** : GitHub reconstruit le site tout
  seul à chaque push sur `gh-pages` ; le workflow le détecte et saute le téléversement.
  Ce réglage économise ~0,5 Go d'artefact par déploiement — le faire une fois à la main
  est donc *recommandé*, mais pas indispensable.

Pourquoi une détection plutôt qu'une configuration : repointer la source via l'API Pages
est une opération réservée aux administrateurs — le `GITHUB_TOKEN` d'un workflow reçoit
« Resource not accessible by integration » (HTTP 403) même avec la permission
`pages: write`. Le workflow ne peut donc pas imposer le réglage, seulement s'y adapter.
C'est ce qui expliquait l'absence totale de publication : la bascule manuelle vers
« Deploy from a branch » prévue par l'approche incrémentale n'avait jamais été faite (la
source était restée « GitHub Actions »), les pushes sur `gh-pages` ne déclenchaient donc
rien (symptôme : aucun run « pages build and deployment » dans l'onglet Actions), et
plus aucun artefact n'était déployé depuis l'abandon de l'approche n° 2 — tous les runs
verts, site jamais mis en ligne.

Si le déploiement par artefact échoue avec « Branch … is not allowed to deploy to
github-pages due to environment protection rules », mettre l'environnement
`github-pages` en « No restriction » (Settings → Environments) : le déploiement doit
pouvoir partir de n'importe quelle branche, pas seulement de `master`.

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

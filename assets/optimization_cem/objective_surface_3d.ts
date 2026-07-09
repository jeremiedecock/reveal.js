// Figure « surface 3D d'une fonction objectif » — dessinée en WebGL avec three.js,
// interactive : glisser à la souris pour tourner autour de la surface, molette pour
// zoomer / dézoomer. Par défaut, la vue tourne lentement toute seule autour de la
// surface ; la première interaction (clic, glisser, molette, tactile) arrête
// définitivement cette rotation automatique. L'apparence imite les surfaces 3D de
// matplotlib : panneaux gris clair quadrillés de blanc qui changent de côté quand
// la caméra tourne, colormap séquentielle appliquée à la surface, étiquettes de
// graduations et d'axes.
//
// Usage dans une slide — un conteneur par figure + le script une seule fois :
//   <div class="r-stretch objective-surface-3d"
//        data-expression="(1 - x)**2 + 100 * (y - x**2)**2"
//        data-name="Rosenbrock function"
//        data-optimum="1 1"></div>
//   <script type="module" src="assets/optimization_cem/objective_surface_3d.ts"></script>
//
// Attributs data-* (tous optionnels sauf data-expression) :
//   data-expression       expression JavaScript de f(x, y), opérateur ** autorisé — REQUIS
//   data-name             nom de la fonction, affiché en titre au-dessus de la figure
//   data-x-domain         "min max" de l'axe x                       (défaut : "-2 2")
//   data-y-domain         "min max" de l'axe y                       (défaut : "-2 2")
//   data-z-domain         "min max" de l'axe z          (défaut : étendue de f sur la grille)
//   data-z-scale          "linear" | "log" — échelle de l'axe z      (défaut : "linear")
//   data-color-scale      "linear" | "log" — échelle de la colormap  (défaut : = data-z-scale)
//   data-colormap         "plasma" | "viridis" | "magma" | "inferno" | "cividis" | "turbo"
//                                                                    (défaut : "plasma")
//   data-colormap-reverse "true" pour inverser la colormap           (défaut : "false")
//   data-resolution       subdivisions de la grille                  (défaut : "160")
//   data-camera           "azimut élévation" initiaux en degrés, convention matplotlib
//                         (azimut autour de z depuis +x, élévation au-dessus du plan xy)
//                                                                    (défaut : "-60 30")
//   data-zoom             zoom initial, >1 rapproche, <1 éloigne     (défaut : "1")
//   data-auto-rotate      "false" pour désactiver la rotation automatique de la vue
//                                                                    (défaut : "true")
//   data-auto-rotate-period
//                         durée d'un tour complet en secondes        (défaut : "10")
//   data-optimum          "x y" de l'optimum global — attribut présent : point rouge
//                         affiché en (x, y, f(x, y)) ; absent : rien
//   data-x-label / data-y-label / data-z-label
//                         étiquettes des axes         (défauts : "x₁", "x₂", "f(x₁, x₂)")
//   data-views            JSON : liste de « vues » pilotées par les fragments reveal.js
//                         de la <section> — views[0] = état initial, views[k+1] = état
//                         quand le fragment d'indice k est visible (la navigation
//                         arrière ramène aux vues précédentes). Champs d'une vue, tous
//                         optionnels :
//                           optimum    bool — montre le point de l'optimum (défaut : caché)
//                           autoRotate bool — rotation automatique (défaut : désactivée)
//                           camera     [azimut, élévation] en degrés
//                           zoom       même convention que data-zoom
//                           target     [x, y] point visé par la caméra (coordonnées des
//                                      données ; défaut : centre de la boîte)
//                           duration   durée en secondes de la transition animée vers
//                                      cette vue (défaut : 2 ; 0 = changement immédiat)
//                         Quand data-views est présent, data-auto-rotate est ignoré
//                         (chaque vue décide) et l'optimum n'est affiché que par les
//                         vues qui le demandent. Une interaction de l'utilisateur
//                         interrompt transition et rotation en cours.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as d3 from 'd3';

type ScaleKind = 'linear' | 'log';

/** Une « vue » de data-views — voir la doc des attributs en tête de fichier. */
interface View {
	optimum?: boolean;
	autoRotate?: boolean;
	camera?: [number, number];
	zoom?: number;
	target?: [number, number];
	duration?: number;
}

// Demi-dimensions de la « boîte » dans laquelle la surface est normalisée
// (rapport 2 × 2 × 1.4, proche du box aspect 4:4:3 de matplotlib).
const HX = 1, HY = 1, HZ = 0.7;

const PANE_COLOR = 0xf2f2f2;   // fond des panneaux (matplotlib : gris ~0.95)
const GRID_COLOR = 0xffffff;   // quadrillage des panneaux
const EDGE_COLOR = 0xbdbdbd;   // arêtes des panneaux
const TICK_COLOR = '#555555';
const LABEL_COLOR = '#000000';
const OPTIMUM_COLOR = 0xff0000; // rouge = optimum, comme les élites des autres figures
const TICK_H = 0.075;          // hauteur (en unités monde) des étiquettes de graduations
const AXIS_LABEL_H = 0.105;    // ... et des étiquettes d'axes
const BASE_DIST = 5.7;         // distance caméra correspondant à zoom = 1

const colormaps: Record<string, (t: number) => string> = {
	plasma: d3.interpolatePlasma,
	viridis: d3.interpolateViridis,
	magma: d3.interpolateMagma,
	inferno: d3.interpolateInferno,
	cividis: d3.interpolateCividis,
	turbo: d3.interpolateTurbo,
};

function parsePair(value: string | undefined, dflt: [number, number]): [number, number] {
	if (!value) return dflt;
	const parts = value.trim().split(/\s+/).map(Number);
	return [parts[0], parts[1]];
}

/** Échelle d'axe : mapping (clampé) domaine -> range + graduations « rondes ». */
interface AxisScale {
	map: (v: number) => number;
	ticks: number[];
}

function makeScale(kind: ScaleKind, d0: number, d1: number, r0: number, r1: number,
	minPositive: number): AxisScale {
	if (kind === 'log') {
		// Borne basse strictement positive (f peut atteindre 0, p. ex. Rosenbrock)
		const lo = d0 > 0 ? d0 : Math.min(minPositive, d1);
		const s = d3.scaleLog().domain([lo, d1]).range([r0, r1]).clamp(true);
		let ticks = s.ticks(6);
		if (ticks.length > 8) {
			ticks = ticks.filter(t => {
				const l = Math.log10(t);
				return Math.abs(l - Math.round(l)) < 1e-9;
			});
		}
		return { map: v => s(Math.max(v, lo)), ticks };
	}
	const s = d3.scaleLinear().domain([d0, d1]).range([r0, r1]).clamp(true);
	return { map: v => s(v), ticks: s.ticks(7) };
}

/** Étiquette de texte : canvas 2D -> texture -> sprite face caméra, taille monde. */
function textSprite(text: string, color: string, height: number, rotation = 0): THREE.Sprite {
	const fontPx = 96; // grand, puis réduit à l'affichage : reste net à l'échelle 4K
	const font = `${fontPx}px 'Source Sans Pro', Helvetica, sans-serif`;
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d')!;
	ctx.font = font;
	canvas.width = Math.max(2, Math.ceil(ctx.measureText(text).width) + 16);
	canvas.height = Math.round(fontPx * 1.35);
	ctx.font = font; // le redimensionnement du canvas réinitialise le contexte
	ctx.fillStyle = color;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, canvas.width / 2, canvas.height / 2);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const material = new THREE.SpriteMaterial({
		map: texture, transparent: true, depthWrite: false, rotation
	});
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(height * canvas.width / canvas.height, height, 1);
	sprite.renderOrder = 1;
	return sprite;
}

function lineSegments(points: number[], color: number): THREE.LineSegments {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
	return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
}

function disposeGroup(group: THREE.Group): void {
	group.traverse(obj => {
		if (obj instanceof THREE.Sprite) {
			// NE PAS disposer obj.geometry : elle est partagée par tous les sprites
			obj.material.map?.dispose();
			obj.material.dispose();
		} else if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
			obj.geometry.dispose();
			(obj.material as THREE.Material).dispose();
		}
	});
}

// ---------------------------------------------------------------------------
// Construction d'une figure dans son conteneur.
// ---------------------------------------------------------------------------
function setupFigure(container: HTMLElement): void {
	const ds = container.dataset;
	if (!ds.expression) {
		console.error('objective_surface_3d: attribut data-expression manquant', container);
		return;
	}
	const f = new Function('x', 'y', `return ${ds.expression};`) as
		(x: number, y: number) => number;

	const [x0, x1] = parsePair(ds.xDomain, [-2, 2]);
	const [y0, y1] = parsePair(ds.yDomain, [-2, 2]);
	const res = parseInt(ds.resolution ?? '160', 10);

	// Valeurs de f sur la grille (res + 1)² et étendue observée
	const values = new Float64Array((res + 1) * (res + 1));
	let vMin = Infinity, vMax = -Infinity, vMinPositive = Infinity;
	for (let j = 0; j <= res; j++) {
		const y = y0 + (j / res) * (y1 - y0);
		for (let i = 0; i <= res; i++) {
			const v = f(x0 + (i / res) * (x1 - x0), y);
			values[j * (res + 1) + i] = v;
			if (v < vMin) vMin = v;
			if (v > vMax) vMax = v;
			if (v > 0 && v < vMinPositive) vMinPositive = v;
		}
	}

	const [z0, z1] = parsePair(ds.zDomain, [vMin, vMax]);
	const zKind = (ds.zScale ?? 'linear') as ScaleKind;
	const cKind = (ds.colorScale ?? zKind) as ScaleKind;

	const sxW = d3.scaleLinear().domain([x0, x1]).range([-HX, HX]);
	const syW = d3.scaleLinear().domain([y0, y1]).range([-HY, HY]);
	const zAxis = makeScale(zKind, z0, z1, -HZ, HZ, vMinPositive);
	const colorAxis = makeScale(cKind, z0, z1, 0, 1, vMinPositive);
	const xTicks = d3.ticks(x0, x1, 5);
	const yTicks = d3.ticks(y0, y1, 5);

	const cmap = colormaps[ds.colormap ?? 'plasma'] ?? d3.interpolatePlasma;
	const reverse = ds.colormapReverse === 'true';

	// -- Surface : géométrie indexée + couleurs par sommet (non éclairée, comme matplotlib)
	const nVerts = (res + 1) * (res + 1);
	const positions = new Float32Array(nVerts * 3);
	const colors = new Float32Array(nVerts * 3);
	const color = new THREE.Color();
	for (let j = 0; j <= res; j++) {
		for (let i = 0; i <= res; i++) {
			const k = j * (res + 1) + i;
			const v = values[k];
			positions[k * 3] = sxW(x0 + (i / res) * (x1 - x0));
			positions[k * 3 + 1] = syW(y0 + (j / res) * (y1 - y0));
			positions[k * 3 + 2] = zAxis.map(v);
			const t = colorAxis.map(v);
			color.setStyle(cmap(reverse ? 1 - t : t));
			colors[k * 3] = color.r;
			colors[k * 3 + 1] = color.g;
			colors[k * 3 + 2] = color.b;
		}
	}
	const indices = new Uint32Array(res * res * 6);
	let idx = 0;
	for (let j = 0; j < res; j++) {
		for (let i = 0; i < res; i++) {
			const a = j * (res + 1) + i;
			indices[idx++] = a; indices[idx++] = a + 1; indices[idx++] = a + res + 1;
			indices[idx++] = a + 1; indices[idx++] = a + res + 2; indices[idx++] = a + res + 1;
		}
	}
	const surfaceGeometry = new THREE.BufferGeometry();
	surfaceGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	surfaceGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	surfaceGeometry.setIndex(new THREE.BufferAttribute(indices, 1));

	const scene = new THREE.Scene();
	scene.add(new THREE.Mesh(surfaceGeometry,
		new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));

	// -- Point de l'optimum global (optionnel ; data-views peut le montrer/cacher)
	let marker: THREE.Mesh | null = null;
	if (ds.optimum !== undefined) {
		const [ox, oy] = parsePair(ds.optimum, [0, 0]);
		marker = new THREE.Mesh(
			new THREE.SphereGeometry(0.035, 24, 16),
			new THREE.MeshBasicMaterial({ color: OPTIMUM_COLOR }));
		marker.position.set(sxW(ox), syW(oy), zAxis.map(f(ox, oy)));
		scene.add(marker);
	}

	// -- Décor « matplotlib » (panneaux, quadrillage, graduations, étiquettes),
	// reconstruit quand la caméra change d'octant pour rester derrière la surface.
	const fmt = d3.format('~g');
	const xLabel = ds.xLabel ?? 'x₁';
	const yLabel = ds.yLabel ?? 'x₂';
	const zLabel = ds.zLabel ?? 'f(x₁, x₂)';

	function buildDecor(xFar: number, yFar: number, zFar: number,
		ex: number, ey: number): THREE.Group {
		const group = new THREE.Group();
		// Les panneaux n'écrivent pas la profondeur et sont rendus avant le
		// quadrillage (renderOrder) : les lignes passent toujours devant eux
		const paneMaterial = new THREE.MeshBasicMaterial({
			color: PANE_COLOR, side: THREE.DoubleSide, depthWrite: false
		});

		const paneX = new THREE.Mesh(new THREE.PlaneGeometry(2 * HZ, 2 * HY), paneMaterial);
		paneX.rotation.y = Math.PI / 2;
		paneX.position.x = xFar;
		const paneY = new THREE.Mesh(new THREE.PlaneGeometry(2 * HX, 2 * HZ), paneMaterial);
		paneY.rotation.x = Math.PI / 2;
		paneY.position.y = yFar;
		const paneZ = new THREE.Mesh(new THREE.PlaneGeometry(2 * HX, 2 * HY), paneMaterial);
		paneZ.position.z = zFar;
		paneX.renderOrder = paneY.renderOrder = paneZ.renderOrder = -2;
		group.add(paneX, paneY, paneZ);

		const xTicksW = xTicks.map(t => sxW(t));
		const yTicksW = yTicks.map(t => syW(t));
		const zTicksW = zAxis.ticks.map(t => zAxis.map(t));

		// Quadrillage blanc de chaque panneau, légèrement décalé vers l'EXTÉRIEUR
		// de la boîte : jamais devant la surface, même là où elle touche la boîte
		// (fond de la vallée sur le sol, bords du domaine sur les murs)
		const eps = 0.0015;
		const grid: number[] = [];
		const gx = xFar + Math.sign(xFar) * eps;
		for (const t of yTicksW) grid.push(gx, t, -HZ, gx, t, HZ);
		for (const t of zTicksW) grid.push(gx, -HY, t, gx, HY, t);
		const gy = yFar + Math.sign(yFar) * eps;
		for (const t of xTicksW) grid.push(t, gy, -HZ, t, gy, HZ);
		for (const t of zTicksW) grid.push(-HX, gy, t, HX, gy, t);
		const gz = zFar + Math.sign(zFar) * eps;
		for (const t of xTicksW) grid.push(t, -HY, gz, t, HY, gz);
		for (const t of yTicksW) grid.push(-HX, t, gz, HX, t, gz);
		const gridLines = lineSegments(grid, GRID_COLOR);
		gridLines.renderOrder = -1;
		group.add(gridLines);

		// Arêtes des trois panneaux
		const edges: number[] = [];
		edges.push(
			xFar, -HY, -HZ, xFar, HY, -HZ, xFar, HY, -HZ, xFar, HY, HZ,
			xFar, HY, HZ, xFar, -HY, HZ, xFar, -HY, HZ, xFar, -HY, -HZ,
			-HX, yFar, -HZ, HX, yFar, -HZ, HX, yFar, -HZ, HX, yFar, HZ,
			HX, yFar, HZ, -HX, yFar, HZ, -HX, yFar, HZ, -HX, yFar, -HZ,
			-HX, -HY, zFar, HX, -HY, zFar, HX, -HY, zFar, HX, HY, zFar,
			HX, HY, zFar, -HX, HY, zFar, -HX, HY, zFar, -HX, -HY, zFar);
		const edgeLines = lineSegments(edges, EDGE_COLOR);
		edgeLines.renderOrder = -1;
		group.add(edgeLines);

		// Graduations x et y : le long des arêtes du panneau du bas côté caméra
		const zOut = zFar + Math.sign(zFar) * 0.06;
		for (const t of xTicks) {
			const s = textSprite(fmt(t), TICK_COLOR, TICK_H);
			s.position.set(sxW(t), -yFar * 1.14, zOut);
			group.add(s);
		}
		for (const t of yTicks) {
			const s = textSprite(fmt(t), TICK_COLOR, TICK_H);
			s.position.set(-xFar * 1.14, syW(t), zOut);
			group.add(s);
		}
		// Graduations z : le long de l'arête verticale extérieure gauche (ex, ey)
		for (const t of zAxis.ticks) {
			const s = textSprite(fmt(t), TICK_COLOR, TICK_H);
			s.position.set(ex * 1.12, ey * 1.12, zAxis.map(t));
			group.add(s);
		}

		// Étiquettes des axes
		const lx = textSprite(xLabel, LABEL_COLOR, AXIS_LABEL_H);
		lx.position.set(0, -yFar * 1.42, zFar + Math.sign(zFar) * 0.16);
		const ly = textSprite(yLabel, LABEL_COLOR, AXIS_LABEL_H);
		ly.position.set(-xFar * 1.42, 0, zFar + Math.sign(zFar) * 0.16);
		const lz = textSprite(zLabel, LABEL_COLOR, AXIS_LABEL_H, Math.PI / 2);
		lz.position.set(ex * 1.38, ey * 1.38, 0);
		group.add(lx, ly, lz);

		return group;
	}

	// -- Rendu WebGL, caméra, contrôles souris
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.domElement.style.width = '100%';
	renderer.domElement.style.height = '100%';
	renderer.domElement.style.display = 'block';
	renderer.domElement.style.cursor = 'grab';
	container.appendChild(renderer.domElement);

	if (ds.name) {
		const title = document.createElement('div');
		title.textContent = ds.name;
		title.style.cssText =
			'position: absolute; top: 0; left: 0; right: 0; text-align: center; ' +
			'font-size: 0.65em; pointer-events: none;';
		container.style.position = 'relative';
		container.appendChild(title);
	}

	// near/far resserrés : meilleure précision du z-buffer (surface contre panneaux)
	const camera = new THREE.PerspectiveCamera(30, 1, 1, 30);
	camera.up.set(0, 0, 1); // z vertical, comme matplotlib
	const [azimDeg, elevDeg] = parsePair(ds.camera, [-60, 30]);
	const zoom = parseFloat(ds.zoom ?? '1');
	const azim = azimDeg * Math.PI / 180, elev = elevDeg * Math.PI / 180;
	// Cible sous le centre de la boîte : le décor (sol, graduations, étiquettes)
	// déborde surtout vers le bas, ce décalage recentre la figure dans le canvas
	const targetZ = -0.18;
	const dist = BASE_DIST / (zoom > 0 ? zoom : 1);
	camera.position.set(
		dist * Math.cos(elev) * Math.cos(azim),
		dist * Math.cos(elev) * Math.sin(azim),
		targetZ + dist * Math.sin(elev));

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.target.set(0, 0, targetZ);
	controls.update();
	controls.enablePan = false;
	controls.minDistance = 2.5;
	controls.maxDistance = 12;

	let decor = new THREE.Group();
	let decorKey = '';
	function updateDecor(): void {
		camera.updateMatrixWorld();
		const xFar = camera.position.x >= 0 ? -HX : HX;
		const yFar = camera.position.y >= 0 ? -HY : HY;
		const zFar = camera.position.z >= 0 ? -HZ : HZ;
		// Deux arêtes verticales « extérieures » possibles pour les graduations z :
		// prendre celle qui est à gauche à l'écran (comme matplotlib)
		const cornerA = new THREE.Vector3(xFar, -yFar, 0).project(camera);
		const cornerB = new THREE.Vector3(-xFar, yFar, 0).project(camera);
		const [ex, ey] = cornerA.x <= cornerB.x ? [xFar, -yFar] : [-xFar, yFar];
		const key = `${xFar} ${yFar} ${zFar} ${ex} ${ey}`;
		if (key === decorKey) return;
		decorKey = key;
		scene.remove(decor);
		disposeGroup(decor);
		decor = buildDecor(xFar, yFar, zFar, ex, ey);
		scene.add(decor);
	}

	// Rendu à la demande uniquement (pas de boucle d'animation permanente)
	let renderQueued = false;
	function requestRender(): void {
		if (renderQueued) return;
		renderQueued = true;
		requestAnimationFrame(() => {
			renderQueued = false;
			updateDecor();
			renderer.render(scene, camera);
		});
	}
	controls.addEventListener('change', requestRender);

	// -- Rotation automatique de la vue, jusqu'à la première interaction.
	// La boucle d'animation (et donc le rendu WebGL à 60 fps) ne tourne que si la
	// figure est réellement à l'écran. Attention : clientWidth > 0 ne suffit PAS —
	// reveal.js garde les slides à moins de `viewDistance` (3) de la slide courante
	// en display:block pour les précharger ; seule la classe `present` de la
	// <section> distingue la slide effectivement affichée.
	controls.autoRotate = ds.autoRotate !== 'false';
	const period = parseFloat(ds.autoRotatePeriod ?? '10');
	// Convention OrbitControls : autoRotateSpeed = 2 ⇔ un tour en 30 s
	controls.autoRotateSpeed = 60 / (period > 0 ? period : 10);
	const revealSection = container.closest('.reveal section');
	function displayed(): boolean {
		return container.clientWidth > 0 &&
			!document.hidden &&
			(revealSection === null || revealSection.classList.contains('present'));
	}
	let spinning = false;
	function spin(): void {
		if (!controls.autoRotate || !displayed()) {
			spinning = false;
			return;
		}
		controls.update(); // applique le pas de rotation et déclenche 'change' → rendu
		requestAnimationFrame(spin);
	}
	function startSpin(): void {
		if (spinning || !controls.autoRotate || !displayed()) return;
		spinning = true;
		requestAnimationFrame(spin);
	}
	// 'start' = début de toute interaction (clic-glisser, molette, tactile) :
	// l'utilisateur prend la main, définitivement — la rotation automatique
	// s'arrête et une éventuelle transition de vue en cours est interrompue
	let userInteracted = false;
	let cancelTween: (() => void) | null = null;
	controls.addEventListener('start', () => {
		userInteracted = true;
		controls.autoRotate = false;
		cancelTween?.();
		cancelTween = null;
	});

	// -- Vues pilotées par les fragments de la slide (data-views) : montrer/cacher
	// l'optimum, (ré)activer la rotation automatique, déplacer la caméra avec une
	// transition animée (easing doux, azimut par le chemin le plus court).
	let views: View[] | null = null;
	if (ds.views) {
		try {
			views = JSON.parse(ds.views) as View[];
		} catch (e) {
			console.error('objective_surface_3d: data-views JSON invalide', e, container);
		}
	}
	const baseTarget = new THREE.Vector3(0, 0, targetZ);

	function applyView(view: View, animate: boolean): void {
		cancelTween?.();
		cancelTween = null;
		if (marker) marker.visible = view.optimum === true;
		controls.autoRotate = view.autoRotate === true && !userInteracted;

		// Position de départ, en sphérique autour de la cible courante
		const fromTarget = controls.target.clone();
		const offset = camera.position.clone().sub(fromTarget);
		const fromDist = offset.length();
		const fromElev = Math.asin(THREE.MathUtils.clamp(offset.z / fromDist, -1, 1));
		const fromAzim = Math.atan2(offset.y, offset.x);

		// Position d'arrivée — les champs absents gardent la valeur courante
		// (sauf la cible, qui revient au centre de la boîte)
		const toTarget = view.target
			? new THREE.Vector3(sxW(view.target[0]), syW(view.target[1]),
				zAxis.map(f(view.target[0], view.target[1])))
			: baseTarget.clone();
		const toAzim = view.camera ? view.camera[0] * Math.PI / 180 : fromAzim;
		const toElev = view.camera ? view.camera[1] * Math.PI / 180 : fromElev;
		const toDist = view.zoom !== undefined && view.zoom > 0
			? BASE_DIST / view.zoom : fromDist;
		let dAzim = (toAzim - fromAzim) % (2 * Math.PI);
		if (dAzim > Math.PI) dAzim -= 2 * Math.PI;
		if (dAzim < -Math.PI) dAzim += 2 * Math.PI;

		const place = (u: number): void => {
			const e = u < 0.5 ? 4 * u ** 3 : 1 - (2 - 2 * u) ** 3 / 2; // easeInOutCubic
			const azim = fromAzim + dAzim * e;
			const elev = fromElev + (toElev - fromElev) * e;
			const d = fromDist + (toDist - fromDist) * e;
			controls.target.lerpVectors(fromTarget, toTarget, e);
			camera.position.set(
				controls.target.x + d * Math.cos(elev) * Math.cos(azim),
				controls.target.y + d * Math.cos(elev) * Math.sin(azim),
				controls.target.z + d * Math.sin(elev));
			camera.lookAt(controls.target);
			requestRender();
		};

		const seconds = animate ? (view.duration ?? 2) : 0;
		if (seconds <= 0 || !displayed()) {
			place(1);
			controls.update();
			startSpin();
			return;
		}
		const t0 = performance.now();
		let cancelled = false;
		cancelTween = () => { cancelled = true; };
		const step = (): void => {
			if (cancelled) return;
			const u = Math.min((performance.now() - t0) / (seconds * 1000), 1);
			place(u);
			if (u < 1) {
				requestAnimationFrame(step);
			} else {
				cancelTween = null;
				controls.update(); // resynchronise l'état interne d'OrbitControls
				startSpin();       // si la vue demande la rotation automatique
			}
		};
		step();
	}

	// Vue courante = plus grand data-fragment-index visible dans la <section> + 1
	// (même convention que cem_rosenbrock.ts), plafonné à la dernière vue.
	function fragmentIndex(): number {
		let idx = -1;
		revealSection?.querySelectorAll('.fragment.visible').forEach(fr => {
			const i = parseInt(fr.getAttribute('data-fragment-index') ?? '', 10);
			if (!Number.isNaN(i) && i > idx) idx = i;
		});
		return idx;
	}

	let viewIndex = 0;
	if (views && views.length > 0) applyView(views[0], false);

	function syncState(): void {
		if (views && views.length > 0) {
			const idx = Math.min(fragmentIndex() + 1, views.length - 1);
			if (idx !== viewIndex) {
				viewIndex = idx;
				applyView(views[idx], displayed());
			}
		}
		startSpin();
	}

	// Resynchroniser à chaque changement d'état : navigation entre slides et
	// fragments (aller ET retour), onglet redevenu visible
	document.addEventListener('visibilitychange', syncState);
	const Reveal = (window as unknown as
		{ Reveal?: { on?: (ev: string, cb: () => void) => void } }).Reveal;
	if (Reveal?.on) {
		for (const ev of ['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden']) {
			Reveal.on(ev, syncState);
		}
	}

	function resize(): void {
		const w = container.clientWidth, h = container.clientHeight;
		if (w === 0 || h === 0) return; // slide cachée (display: none)
		// reveal.js met le deck à l'échelle par un transform CSS : compenser pour
		// garder un rendu net (notamment sur écran 4K, où scale ≈ 3)
		const scale = (container.getBoundingClientRect().width / w) || 1;
		renderer.setPixelRatio(Math.min(window.devicePixelRatio * scale, 3));
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		requestRender();
		startSpin();
	}
	new ResizeObserver(resize).observe(container);
	window.addEventListener('resize', resize);
	resize();
}

document.querySelectorAll<HTMLElement>('.objective-surface-3d').forEach(setupFigure);

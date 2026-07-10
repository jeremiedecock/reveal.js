// Figure « surface 3D d'une fonction objectif » — dessinée en WebGL avec three.js,
// interactive : glisser à la souris pour tourner autour de la surface, molette pour
// zoomer / dézoomer. Par défaut, la vue tourne lentement toute seule autour de la
// surface ; la première interaction (clic, glisser, molette, tactile) arrête
// définitivement cette rotation automatique. Le décor est minimaliste : trois
// simples droites pour les axes x₁, x₂ et f(x₁, x₂) (avec graduations et
// étiquettes), qui changent de côté quand la caméra tourne pour rester du côté
// visible ; colormap séquentielle appliquée à la surface.
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
//                           flatten    0 à 1 — aplatit la surface sur le plan du sol
//                                      (1 = carte 2D : combiné à une vue de dessus, le
//                                      rendu coïncide avec un tracé 2D, sans distorsion
//                                      de perspective ; défaut : 0 = relief normal)
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
	flatten?: number;
	duration?: number;
}

// Demi-dimensions de la « boîte » dans laquelle la surface est normalisée
// (rapport 2 × 2 × 1.4, proche du box aspect 4:4:3 de matplotlib).
const HX = 1, HY = 1, HZ = 0.7;

const AXIS_COLOR = 0x555555;   // droites des axes et graduations
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
	const surface = new THREE.Mesh(surfaceGeometry,
		new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
	scene.add(surface);

	// -- Point de l'optimum global (optionnel ; data-views peut le montrer/cacher)
	let marker: THREE.Mesh | null = null;
	let markerBaseZ = 0;
	if (ds.optimum !== undefined) {
		const [ox, oy] = parsePair(ds.optimum, [0, 0]);
		marker = new THREE.Mesh(
			new THREE.SphereGeometry(0.035, 24, 16),
			new THREE.MeshBasicMaterial({ color: OPTIMUM_COLOR }));
		markerBaseZ = zAxis.map(f(ox, oy));
		marker.position.set(sxW(ox), syW(oy), markerBaseZ);
		scene.add(marker);
	}

	// Aplatissement de la surface sur le plan du sol (z = -HZ) : z' = -HZ + (z + HZ)·s
	// avec s = 1 - flatten (s plancher à 0.001 pour ne pas devenir coplanaire au sol)
	let flattenNow = 0;
	function applyFlatten(v: number): void {
		flattenNow = v;
		const s = Math.max(1 - v, 0.001);
		surface.scale.z = s;
		surface.position.z = -HZ * (1 - s);
		if (marker) marker.position.z = -HZ + (markerBaseZ + HZ) * s;
	}

	// -- Décor minimaliste (droites des axes, graduations, étiquettes),
	// reconstruit quand la caméra change d'octant pour rester du côté visible.
	const fmt = d3.format('~g');
	const xLabel = ds.xLabel ?? 'x₁';
	const yLabel = ds.yLabel ?? 'x₂';
	const zLabel = ds.zLabel ?? 'f(x₁, x₂)';

	function buildDecor(xFar: number, yFar: number, zFar: number,
		ex: number, ey: number, hideZ: boolean): THREE.Group {
		const group = new THREE.Group();

		// Trois droites le long des arêtes de la boîte : x₁ et x₂ sur les bords du
		// bas côté caméra (là où se trouvent leurs graduations), f(x₁, x₂) sur
		// l'arête verticale extérieure gauche — plus de courtes marques de
		// graduation pointant vers l'extérieur
		const tickLen = 0.045;
		const axes: number[] = [
			-HX, -yFar, zFar, HX, -yFar, zFar,   // axe x₁
			-xFar, -HY, zFar, -xFar, HY, zFar];  // axe x₂
		for (const t of xTicks) {
			const x = sxW(t);
			axes.push(x, -yFar, zFar, x, -yFar - Math.sign(yFar) * tickLen, zFar);
		}
		for (const t of yTicks) {
			const y = syW(t);
			axes.push(-xFar, y, zFar, -xFar - Math.sign(xFar) * tickLen, y, zFar);
		}
		if (!hideZ) {
			axes.push(ex, ey, -HZ, ex, ey, HZ);  // axe f(x₁, x₂)
			for (const t of zAxis.ticks) {
				const z = zAxis.map(t);
				axes.push(ex, ey, z,
					ex + Math.sign(ex) * tickLen, ey + Math.sign(ey) * tickLen, z);
			}
		}
		group.add(lineSegments(axes, AXIS_COLOR));

		// Graduations x et y : le long des droites d'axes du bas côté caméra
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
		// Graduations z : le long de l'arête verticale extérieure gauche (ex, ey) —
		// sauf en vue plongeante, où cette arête est vue par la tranche et où les
		// étiquettes s'empileraient en un paquet illisible
		if (!hideZ) {
			for (const t of zAxis.ticks) {
				const s = textSprite(fmt(t), TICK_COLOR, TICK_H);
				s.position.set(ex * 1.12, ey * 1.12, zAxis.map(t));
				group.add(s);
			}
		}

		// Étiquettes des axes
		const lx = textSprite(xLabel, LABEL_COLOR, AXIS_LABEL_H);
		lx.position.set(0, -yFar * 1.42, zFar + Math.sign(zFar) * 0.16);
		const ly = textSprite(yLabel, LABEL_COLOR, AXIS_LABEL_H);
		ly.position.set(-xFar * 1.42, 0, zFar + Math.sign(zFar) * 0.16);
		group.add(lx, ly);
		if (!hideZ) {
			const lz = textSprite(zLabel, LABEL_COLOR, AXIS_LABEL_H, Math.PI / 2);
			lz.position.set(ex * 1.38, ey * 1.38, 0);
			group.add(lz);
		}

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
		// Au-delà de 75° d'élévation (vue plongeante), l'axe z est vu par la
		// tranche : sa droite et ses étiquettes sont masquées — de même quand la
		// surface est aplatie en carte 2D (l'axe z n'encadrerait que du vide)
		const offset = camera.position.clone().sub(controls.target);
		const hideZ = flattenNow > 0.9 ||
			Math.abs(offset.z) / offset.length() > Math.sin(75 * Math.PI / 180);
		const key = `${xFar} ${yFar} ${zFar} ${ex} ${ey} ${hideZ}`;
		if (key === decorKey) return;
		decorKey = key;
		scene.remove(decor);
		disposeGroup(decor);
		decor = buildDecor(xFar, yFar, zFar, ex, ey, hideZ);
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
		// Élévation bornée à ±89.9° : au zénith exact, lookAt est dégénéré
		// (up ∥ ligne de visée) ; à 89.9° la vue est indiscernable d'une vue de
		// dessus et l'écran garde une orientation stable (le côté opposé à
		// l'azimut de la caméra apparaît en haut)
		const toElev = view.camera
			? THREE.MathUtils.clamp(view.camera[1], -89.9, 89.9) * Math.PI / 180
			: fromElev;
		const toDist = view.zoom !== undefined && view.zoom > 0
			? BASE_DIST / view.zoom : fromDist;
		const fromFlatten = flattenNow;
		const toFlatten = THREE.MathUtils.clamp(view.flatten ?? 0, 0, 1);
		let dAzim = (toAzim - fromAzim) % (2 * Math.PI);
		if (dAzim > Math.PI) dAzim -= 2 * Math.PI;
		if (dAzim < -Math.PI) dAzim += 2 * Math.PI;

		const place = (u: number): void => {
			const e = u < 0.5 ? 4 * u ** 3 : 1 - (2 - 2 * u) ** 3 / 2; // easeInOutCubic
			applyFlatten(fromFlatten + (toFlatten - fromFlatten) * e);
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

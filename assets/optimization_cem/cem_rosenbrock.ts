// Version d3.js des figures « CEM sur la fonction de Rosenbrock » (contours de
// f, ellipses de la proposal distribution, échantillons et élites par itération).
//
// Contrairement à la v2 (assets/optimization_cem_v2/), les données par itération
// ne sont pas lues dans un JSON précalculé : elles sont recalculées au chargement
// de la page par l'implémentation TypeScript du CEM (cem.ts), avec une seed de
// random fixée — l'exécution est donc parfaitement reproductible. L'apparence
// (fonction objectif, paramètres du CEM, niveaux de contours, couleurs) vient de
// cem_rosenbrock_config.json, éditable à la main.
//
// Usage dans une slide — figure statique :
//   <svg class="cem-rosenbrock-fig" data-iteration="3" data-phase="fit" …></svg>
// ou figure pilotée par les fragments de sa <section> (un jeton "k:phase" par
// data-fragment-index, data-initial-frame pour l'état avant le premier fragment,
// absent = figure cachée) :
//   <svg class="cem-rosenbrock-fig" data-initial-frame="1:proposal"
//        data-frames="1:samples 1:fit 2:proposal …"></svg>
// Phases : objective = contours de f seuls (fond, sans titre d'itération) ;
//          proposal = ellipses de la distribution courante seules ;
//          samples  = + échantillons ; elite = échantillons + élites en rouge
//          (sans distribution) ; fit = + distribution ajustée sur les élites
//          (rouge, = proposal de l'itération k+1).
import * as d3 from 'd3';
import { cem } from './cem';
import config from './cem_rosenbrock_config.json';

type Phase = 'objective' | 'proposal' | 'samples' | 'elite' | 'fit';
interface Frame { k: number; phase: Phase; }

const VB_W = 420, VB_H = 400;
const margin = { top: 28, right: 25, bottom: 32, left: 55 };
const plotW = VB_W - margin.left - margin.right;   // 340
const plotH = VB_H - margin.top - margin.bottom;   // 340

const [x0, x1] = config.objective.xDomain;
const [y0, y1] = config.objective.yDomain;
const xScale = d3.scaleLinear().domain([x0, x1]).range([0, plotW]);
const yScale = d3.scaleLinear().domain([y0, y1]).range([plotH, 0]);

// ---------------------------------------------------------------------------
// Fonction objectif (partagée par les courbes de niveau et par le CEM) et
// exécution du CEM : calculées une seule fois, pour toutes les figures de la
// page. `run[k - 1]` contient tout ce que l'itération k a produit.
// ---------------------------------------------------------------------------
const f = new Function('x', 'y', `return ${config.objective.expression};`) as
	(x: number, y: number) => number;

const run = cem(([x, y]) => f(x, y), config.cem);

// Contours de la fonction objectif
const n = config.objective.gridResolution;
const values = new Array<number>(n * n);
for (let j = 0; j < n; j++) {
	const y = y0 + ((j + 0.5) / n) * (y1 - y0);
	for (let i = 0; i < n; i++) {
		values[j * n + i] = f(x0 + ((i + 0.5) / n) * (x1 - x0), y);
	}
}
const levels = config.objective.contourLevels;
const objectiveContours = d3.contours().size([n, n]).thresholds(levels)(values);

// grille -> pixels de la zone de tracé
const gridToSvg = (gx: number, gy: number): [number, number] =>
	[xScale(x0 + (gx / n) * (x1 - x0)), yScale(y0 + (gy / n) * (y1 - y0))];
const contourPath = d3.geoPath(d3.geoTransform({
	point(gx, gy) { this.stream.point(...gridToSvg(gx, gy)); }
}));

const logMin = Math.log(levels[0]), logMax = Math.log(levels[levels.length - 1]);
const levelColor = (lv: number): string =>
	d3.interpolateViridis(1 - (Math.log(lv) - logMin) / (logMax - logMin));

// Étiquettes inline des niveaux (façon matplotlib clabel) : 1 ou 2 par anneau
// selon son périmètre, orientées le long de la courbe, filtrées près des bords.
interface Label { x: number; y: number; angle: number; text: string; color: string; }
const contourLabels: Label[] = [];
for (const contour of objectiveContours) {
	if (!config.objective.labeledLevels.some(lv => Math.abs(lv - contour.value) < 1e-9)) continue;
	for (const polygon of contour.coordinates) {
		const ring = (polygon[0] as [number, number][]).map(p => gridToSvg(p[0], p[1]));
		const segLen = ring.map((p, i) => {
			const q = ring[(i + 1) % ring.length];
			return Math.hypot(q[0] - p[0], q[1] - p[1]);
		});
		const perimeter = d3.sum(segLen);
		const fractions = perimeter > 300 ? [0.25, 0.75] : [0.5];
		for (const frac of fractions) {
			let target = frac * perimeter, i = 0;
			while (i < ring.length - 1 && target > segLen[i]) target -= segLen[i++];
			const [px, py] = ring[i];
			const [qx, qy] = ring[(i + 1) % ring.length];
			if (px < 14 || px > plotW - 14 || py < 12 || py > plotH - 12) continue;
			let angle = Math.atan2(qy - py, qx - px) * 180 / Math.PI;
			if (angle > 90) angle -= 180;
			if (angle < -90) angle += 180;
			contourLabels.push({
				x: px, y: py, angle,
				text: String(Math.round(contour.value)),
				color: levelColor(contour.value)
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Ellipses de niveau d'une gaussienne N(mu, sigma) : la densité vaut `level`
// sur l'ellipse de rayon de Mahalanobis r = sqrt(2 ln(pic / level)).
// ---------------------------------------------------------------------------
interface EllipseSpec { cx: number; cy: number; rx: number; ry: number; rotate: number; }
function gaussianLevelEllipses(mu: number[], sigma: number[][]): EllipseSpec[] {
	const [a, b, c] = [sigma[0][0], sigma[0][1], sigma[1][1]];
	const det = a * c - b * b;
	if (det <= 0) return [];
	const peak = 1 / (2 * Math.PI * Math.sqrt(det));
	const disc = Math.sqrt(Math.max(((a - c) / 2) ** 2 + b * b, 0));
	const l1 = (a + c) / 2 + disc, l2 = (a + c) / 2 - disc; // valeurs propres
	const theta = 0.5 * Math.atan2(2 * b, a - c);           // orientation de l1
	const pxPerUnit = plotW / (x1 - x0);                    // repère isométrique
	return config.proposal.pdfLevels
		.filter(lv => lv < peak)
		.map(lv => {
			const r = Math.sqrt(2 * Math.log(peak / lv));
			return {
				cx: xScale(mu[0]), cy: yScale(mu[1]),
				rx: r * Math.sqrt(l1) * pxPerUnit, ry: r * Math.sqrt(l2) * pxPerUnit,
				rotate: -theta * 180 / Math.PI // y inversé en SVG
			};
		});
}

// ---------------------------------------------------------------------------
// Construction d'une figure dans un <svg> : fond statique (contours de f,
// étiquettes, axes, cadre) + groupes redessinés à chaque frame.
// ---------------------------------------------------------------------------
let uid = 0;
function setupFigure(el: SVGSVGElement): (frame: Frame | null) => void {
	const svg = d3.select(el)
		.attr('viewBox', `0 0 ${VB_W} ${VB_H}`)
		.attr('preserveAspectRatio', 'xMidYMid meet');
	const clipId = `cem-rosenbrock-clip-${uid++}`;
	svg.append('defs').append('clipPath').attr('id', clipId)
		.append('rect').attr('width', plotW).attr('height', plotH);
	const root = svg.append('g')
		.attr('transform', `translate(${margin.left},${margin.top})`);

	const base = root.append('g').attr('clip-path', `url(#${clipId})`);
	for (const contour of objectiveContours) {
		base.append('path')
			.attr('d', contourPath(contour))
			.attr('fill', 'none')
			.attr('stroke', levelColor(contour.value))
			.attr('stroke-width', config.objective.strokeWidth);
	}
	for (const lab of contourLabels) {
		root.append('text')
			.attr('transform', `translate(${lab.x},${lab.y}) rotate(${lab.angle})`)
			.attr('text-anchor', 'middle').attr('dy', '0.35em')
			.attr('font-size', 12).attr('font-family', 'sans-serif')
			.attr('fill', lab.color)
			.attr('stroke', '#ffffff').attr('stroke-width', 3)
			.attr('paint-order', 'stroke')
			.text(lab.text);
	}

	// Axes + cadre (boîte complète, comme matplotlib)
	const tickText = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) =>
		sel.selectAll('text').attr('font-size', 13).attr('font-family', 'sans-serif').attr('fill', '#000');
	root.append('g').attr('transform', `translate(0,${plotH})`)
		.call(d3.axisBottom(xScale).tickValues(config.axes.xTicks).tickFormat(d3.format('d')).tickSizeOuter(0))
		.call(tickText);
	root.append('g')
		.call(d3.axisLeft(yScale).tickValues(config.axes.yTicks).tickFormat(d3.format('.1f')).tickSizeOuter(0))
		.call(tickText);
	root.append('rect')
		.attr('width', plotW).attr('height', plotH)
		.attr('fill', 'none').attr('stroke', '#000').attr('stroke-width', 1);

	const title = root.append('text')
		.attr('x', plotW / 2).attr('y', -10)
		.attr('text-anchor', 'middle')
		.attr('font-size', 16).attr('font-family', 'sans-serif').attr('fill', '#000');

	const gProposal = root.append('g').attr('clip-path', `url(#${clipId})`);
	const gSamples = root.append('g').attr('clip-path', `url(#${clipId})`);

	return (frame: Frame | null): void => {
		if (frame === null || frame.k > run.length) {
			svg.style('visibility', 'hidden');
			return;
		}
		svg.style('visibility', 'visible');
		title.text(frame.phase === 'objective' ? '' : config.title.replace('{k}', String(frame.k)));
		const iter = run[frame.k - 1];

		gProposal.selectAll('*').remove();
		const distributions: { mu: number[]; sigma: number[][]; color: string }[] = [];
		if (frame.phase === 'proposal' || frame.phase === 'samples') {
			distributions.push({ ...iter.proposal, color: config.proposal.currentColor });
		} else if (frame.phase === 'fit') {
			distributions.push({ ...iter.fitted, color: config.proposal.fittedColor });
		}
		for (const dist of distributions) {
			for (const e of gaussianLevelEllipses(dist.mu, dist.sigma)) {
				gProposal.append('ellipse')
					.attr('cx', e.cx).attr('cy', e.cy)
					.attr('rx', e.rx).attr('ry', e.ry)
					.attr('transform', `rotate(${e.rotate},${e.cx},${e.cy})`)
					.attr('fill', 'none')
					.attr('stroke', dist.color)
					.attr('stroke-width', config.proposal.strokeWidth)
					.attr('stroke-dasharray', config.proposal.dash);
			}
		}

		gSamples.selectAll('*').remove();
		if (frame.phase !== 'objective' && frame.phase !== 'proposal') {
			const showElite = frame.phase === 'elite' || frame.phase === 'fit';
			for (const s of iter.samples) {
				const color = showElite && s.elite ? config.samples.eliteColor : config.samples.color;
				gSamples.append('circle')
					.attr('cx', xScale(s.x[0])).attr('cy', yScale(s.x[1]))
					.attr('r', config.samples.radius)
					.attr('fill', color)
					.attr('stroke', color)
					.attr('stroke-width', config.samples.strokeWidth);
			}
		}
	};
}

// ---------------------------------------------------------------------------
// Enregistrement des figures de la page et synchronisation avec les fragments.
// ---------------------------------------------------------------------------
function parseFrame(token: string): Frame {
	const [k, phase] = token.split(':');
	return { k: parseInt(k, 10), phase: phase as Phase };
}

interface DynamicFig {
	render: (frame: Frame | null) => void;
	section: HTMLElement;
	frames: Frame[];
	initial: Frame | null;
}
const dynamicFigs: DynamicFig[] = [];

document.querySelectorAll<SVGSVGElement>('svg.cem-rosenbrock-fig').forEach(el => {
	const render = setupFigure(el);
	if (el.dataset.frames) {
		const frames = el.dataset.frames.trim().split(/\s+/).map(parseFrame);
		const initial = el.dataset.initialFrame ? parseFrame(el.dataset.initialFrame) : null;
		dynamicFigs.push({ render, section: el.closest('section')!, frames, initial });
		render(initial);
	} else {
		render({
			k: parseInt(el.dataset.iteration ?? '1', 10),
			phase: (el.dataset.phase ?? 'fit') as Phase
		});
	}
});

// Frame courante = plus grand data-fragment-index visible dans la <section>
// (les slides utilisent des index explicites, partagés entre texte et figure).
function update(): void {
	for (const fig of dynamicFigs) {
		let idx = -1;
		fig.section.querySelectorAll('.fragment.visible').forEach(fr => {
			const i = parseInt(fr.getAttribute('data-fragment-index') ?? '', 10);
			if (!Number.isNaN(i) && i > idx) idx = i;
		});
		const frame = idx < 0 ? fig.initial : fig.frames[Math.min(idx, fig.frames.length - 1)];
		fig.render(frame ?? null);
	}
}

if (dynamicFigs.length > 0) {
	const Reveal = (window as unknown as { Reveal?: { on?: (ev: string, cb: () => void) => void } }).Reveal;
	if (Reveal?.on) {
		for (const ev of ['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden']) {
			Reveal.on(ev, update);
		}
	}
	update();
}

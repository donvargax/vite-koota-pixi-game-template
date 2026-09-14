import type { World } from "../ecs/facade.ts";
import { FoeTag, Health } from "../game/actors.ts";
import { Projectile } from "../game/combat.ts";
import type { GameViewModel, RenderProjection } from "../game/game-view-model.ts";
import { Sprite } from "../game/presentation.ts";
import { Position, Velocity } from "../game/spatial.ts";
import type { ScenarioDefinition, WorkloadRecord } from "../../performance/contracts.ts";

const MAX_COUNTER = 1_000_000;

export interface BenchmarkWorkloadContext {
	readonly world: World;
	readonly model: GameViewModel;
}

export interface BenchmarkWorkloadOptions {
	readonly scenario: ScenarioDefinition;
}

export interface BenchmarkWorkload {
	beforeSimulation(dtSeconds: number): void;
	afterSimulation(dtSeconds: number): void;
	afterRender(projection: RenderProjection): void;
	resetWindow(): void;
	getWindowRecord(rawWallSeconds?: number): WorkloadRecord;
	dispose(): void;
}

export function createBenchmarkWorkload(
	context: BenchmarkWorkloadContext,
	options: BenchmarkWorkloadOptions,
): BenchmarkWorkload {
	return new RealGameWorkload(context, options.scenario);
}

class RealGameWorkload implements BenchmarkWorkload {
	private readonly scenario: ScenarioDefinition;
	private readonly world: World;
	private readonly random: () => number;
	private disposed = false;
	private beforeSimulationFoes = 0;
	private afterSimulationFoes = 0;
	private afterMaintenanceFoes = 0;
	private beforeSimulationBolts = 0;
	private afterSimulationBolts = 0;
	private afterMaintenanceBolts = 0;
	private projectedOnScreenBolts = 0;
	private spawnCount = 0;
	private recycleCount = 0;
	private removalCount = 0;
	private hitCount = 0;
	private foeDownCount = 0;
	private simulationSeconds = 0;
	private successfulRenderCount = 0;
	private minimumLoad = Number.POSITIVE_INFINITY;
	private maximumLoad = 0;
	private previousFoeIds = new Set<number>();
	private previousBoltIds = new Set<number>();
	private previousHealth = new Map<number, number>();

	constructor(context: BenchmarkWorkloadContext, scenario: ScenarioDefinition) {
		this.world = context.world;
		this.scenario = scenario;
		this.random = seededRandom(scenario.seed);
		this.seedTargets();
	}

	beforeSimulation(dtSeconds: number): void {
		this.ensureActive();
		this.maintainFoes();
		this.maintainBolts(false);
		const foes = this.foeEntries();
		const bolts = this.boltEntries();
		this.beforeSimulationFoes = foes.length;
		this.beforeSimulationBolts = bolts.length;
		this.previousFoeIds = new Set(foes.map(({ entity }) => entity.id));
		this.previousBoltIds = new Set(bolts.map(({ entity }) => entity.id));
		this.previousHealth = new Map(
			foes.flatMap(({ entity }) => {
				const health = entity.get(Health);
				return health ? [[entity.id, health.value] as const] : [];
			}),
		);
		this.minimumLoad = Math.min(this.minimumLoad, foes.length + bolts.length);
		this.maximumLoad = Math.max(this.maximumLoad, foes.length + bolts.length);
		this.assertPopulationBound(foes.length + bolts.length);
		void dtSeconds;
	}

	afterSimulation(dtSeconds: number): void {
		this.ensureActive();
		const foes = this.foeEntries();
		const bolts = this.boltEntries();
		this.afterSimulationFoes = foes.length;
		this.afterSimulationBolts = bolts.length;
		this.simulationSeconds += Math.max(0, dtSeconds);
		this.removalCount = boundedIncrement(
			this.removalCount,
			countMissing(
				this.previousFoeIds,
				foes.map(({ entity }) => entity.id),
			) +
				countMissing(
					this.previousBoltIds,
					bolts.map(({ entity }) => entity.id),
				),
		);
		for (const { entity } of foes) {
			const oldHealth = this.previousHealth.get(entity.id);
			const health = entity.get(Health)?.value;
			if (oldHealth !== undefined && health !== undefined && health < oldHealth) {
				this.hitCount = boundedIncrement(this.hitCount, 1);
			}
		}
		this.maintainFoes();
		this.maintainBolts(true);
		this.afterMaintenanceFoes = this.foeEntries().length;
		this.afterMaintenanceBolts = this.boltEntries().length;
		const load = this.afterMaintenanceFoes + this.afterMaintenanceBolts;
		this.minimumLoad = Math.min(this.minimumLoad, load);
		this.maximumLoad = Math.max(this.maximumLoad, load);
		this.assertPopulationBound(load);
	}

	afterRender(projection: RenderProjection): void {
		this.ensureActive();
		this.successfulRenderCount = boundedIncrement(this.successfulRenderCount, 1);
		this.projectedOnScreenBolts = projection.entities.filter(
			(entity) =>
				entity.kind === "bolt" &&
				entity.x >= this.scenario.layout.worldMinX &&
				entity.x <= this.scenario.layout.worldMaxX &&
				entity.y >= this.scenario.layout.groundY &&
				entity.y <= this.scenario.layout.boltUpperLaneY,
		).length;
	}

	resetWindow(): void {
		this.ensureActive();
		this.beforeSimulationFoes = 0;
		this.afterSimulationFoes = 0;
		this.afterMaintenanceFoes = 0;
		this.beforeSimulationBolts = 0;
		this.afterSimulationBolts = 0;
		this.afterMaintenanceBolts = 0;
		this.projectedOnScreenBolts = 0;
		this.spawnCount = 0;
		this.recycleCount = 0;
		this.removalCount = 0;
		this.hitCount = 0;
		this.foeDownCount = 0;
		this.simulationSeconds = 0;
		this.successfulRenderCount = 0;
		this.minimumLoad = Number.POSITIVE_INFINITY;
		this.maximumLoad = 0;
		this.previousFoeIds.clear();
		this.previousBoltIds.clear();
		this.previousHealth.clear();
	}

	getWindowRecord(rawWallSeconds = this.simulationSeconds): WorkloadRecord {
		this.ensureActive();
		const wallSeconds = Math.max(0, rawWallSeconds);
		const failures = this.validityFailures(wallSeconds);
		return {
			schema: "workload",
			schemaVersion: 1,
			scenarioId: this.scenario.id,
			repetition: 0,
			beforeSimulationFoes: this.beforeSimulationFoes,
			afterSimulationFoes: this.afterSimulationFoes,
			afterMaintenanceFoes: this.afterMaintenanceFoes,
			beforeSimulationBolts: this.beforeSimulationBolts,
			afterSimulationBolts: this.afterSimulationBolts,
			afterMaintenanceBolts: this.afterMaintenanceBolts,
			projectedOnScreenBolts: this.projectedOnScreenBolts,
			spawnCount: this.spawnCount,
			recycleCount: this.recycleCount,
			removalCount: this.removalCount,
			hitCount: this.hitCount,
			foeDownCount: this.foeDownCount,
			simulationSeconds: this.simulationSeconds,
			rawWallSeconds: wallSeconds,
			minimumLoad: Number.isFinite(this.minimumLoad) ? this.minimumLoad : 0,
			maximumLoad: this.maximumLoad,
			progressValid: failures.length === 0,
			validityStatus: failures.length === 0 ? "valid" : "invalid",
			failures,
		};
	}

	dispose(): void {
		this.disposed = true;
		this.previousFoeIds.clear();
		this.previousBoltIds.clear();
		this.previousHealth.clear();
	}

	private seedTargets(): void {
		for (let index = 0; index < this.scenario.targets.foes; index++) this.spawnFoe(index);
		for (let index = 0; index < this.scenario.targets.bolts; index++) this.spawnBolt(index);
	}

	private maintainFoes(): void {
		const entries = this.foeEntries();
		for (const [index, { components }] of entries.entries()) {
			const slot = this.slotX(index);
			components.position.x = slot;
			components.position.y = this.scenario.layout.groundY;
		}
		if (entries.length > this.scenario.targets.foes) {
			for (const { entity } of entries.slice(this.scenario.targets.foes)) {
				entity.destroy();
				this.recycleCount = boundedIncrement(this.recycleCount, 1);
			}
		}
		for (let index = entries.length; index < this.scenario.targets.foes; index++)
			this.spawnFoe(index);
	}

	private maintainBolts(countReplenishment: boolean): void {
		let entries = this.boltEntries();
		for (const { entity, components } of entries) {
			if (
				components.position.x < this.scenario.layout.worldMinX - 64 ||
				components.position.x > this.scenario.layout.worldMaxX + 64
			) {
				entity.destroy();
				this.recycleCount = boundedIncrement(this.recycleCount, 1);
			}
		}
		entries = this.boltEntries();
		if (entries.length > this.scenario.targets.bolts) {
			for (const { entity } of entries.slice(this.scenario.targets.bolts)) {
				entity.destroy();
				this.recycleCount = boundedIncrement(this.recycleCount, 1);
			}
		}
		entries = this.boltEntries();
		for (let index = entries.length; index < this.scenario.targets.bolts; index++) {
			this.spawnBolt(index);
			if (countReplenishment) this.recycleCount = boundedIncrement(this.recycleCount, 1);
		}
	}

	private spawnFoe(index: number): void {
		this.world.spawn(
			new Position(this.slotX(index), this.scenario.layout.groundY),
			new Velocity(0, 0),
			new Health(3),
			new Sprite("zombie"),
			new FoeTag(),
		);
		this.spawnCount = boundedIncrement(this.spawnCount, 1);
	}

	private spawnBolt(index: number): void {
		const upper = this.random() < this.scenario.targets.upperLaneBoltRatio;
		const speed = lerp(
			this.scenario.targets.boltVelocityMin,
			this.scenario.targets.boltVelocityMax,
			this.random(),
		);
		const direction = this.random() < 0.5 ? -1 : 1;
		const baseX = upper
			? this.randomBetween(this.scenario.layout.worldMinX, this.scenario.layout.worldMaxX)
			: this.groundBoltX(index);
		const y = upper ? this.scenario.layout.boltUpperLaneY : this.scenario.layout.boltGroundLaneY;
		this.world.spawn(
			new Position(baseX, y),
			new Velocity(direction * speed, 0),
			new Projectile(this.scenario.targets.boltDamage, this.scenario.targets.finiteBoltLifeSeconds),
			new Sprite("bolt"),
		);
		this.spawnCount = boundedIncrement(this.spawnCount, 1);
	}

	private groundBoltX(index: number): number {
		if (this.scenario.targets.foes === 0)
			return this.randomBetween(this.scenario.layout.worldMinX, this.scenario.layout.worldMaxX);
		return this.clamp(this.slotX(index % this.scenario.targets.foes) + (this.random() - 0.5) * 24);
	}

	private randomBetween(min: number, max: number): number {
		return min + (max - min) * this.random();
	}

	private clamp(value: number): number {
		return Math.max(
			this.scenario.layout.worldMinX,
			Math.min(this.scenario.layout.worldMaxX, value),
		);
	}

	private slotX(index: number): number {
		const count = Math.max(1, this.scenario.targets.foes - 1);
		return (
			this.scenario.layout.worldMinX +
			(index / count) * (this.scenario.layout.worldMaxX - this.scenario.layout.worldMinX)
		);
	}

	private foeEntries(): Array<{
		entity: ReturnType<World["query"]>["entities"][number];
		components: { position: Position; foe: FoeTag };
	}> {
		return [...this.world.query({ position: Position, foe: FoeTag })];
	}

	private boltEntries(): Array<{
		entity: ReturnType<World["query"]>["entities"][number];
		components: { position: Position; projectile: Projectile };
	}> {
		return [...this.world.query({ position: Position, projectile: Projectile })];
	}

	private validityFailures(rawWallSeconds: number): WorkloadRecord["failures"] {
		const validity = this.scenario.validity;
		return [
			...collectFailures([
				[
					this.beforeSimulationFoes !== validity.beforeSimulationFoes,
					"before-simulation foes",
					false,
				],
				[
					this.afterMaintenanceFoes !== validity.afterMaintenanceFoes,
					"after-maintenance foes",
					false,
				],
				[
					this.beforeSimulationBolts !== validity.beforeSimulationBolts,
					"before-simulation bolts",
					false,
				],
				[
					this.afterMaintenanceBolts !== validity.afterMaintenanceBolts,
					"after-maintenance bolts",
					false,
				],
			]),
			...collectFailures([
				[
					this.projectedOnScreenBolts < validity.projectedVisibleBoltsMinimum,
					"projected visible bolts",
					true,
				],
				[this.simulationSeconds < validity.minimumSimulationSeconds, "simulation progress", true],
				[rawWallSeconds < validity.minimumWallSeconds, "wall-time progress", true],
				[
					this.successfulRenderCount < validity.minimumSuccessfulRenderCount,
					"render progress",
					true,
				],
				[this.maximumLoad > validity.hardPopulationCeiling, "population ceiling", false],
			]),
		];
	}

	private assertPopulationBound(load: number): void {
		if (load > this.scenario.validity.hardPopulationCeiling) {
			throw new Error(`Workload ${this.scenario.id} exceeded population ceiling`);
		}
	}

	private ensureActive(): void {
		if (this.disposed) throw new Error("Benchmark workload is disposed");
	}
}

function collectFailures(
	checks: readonly (readonly [boolean, string, boolean])[],
): WorkloadRecord["failures"] {
	return checks
		.filter(([invalidCheck]) => invalidCheck)
		.map(([, message, retryable]) => ({
			kind: "workload-invalid" as const,
			phase: "workload",
			message,
			retryable,
		}));
}

function countMissing(previous: Set<number>, current: readonly number[]): number {
	const present = new Set(current);
	let missing = 0;
	for (const id of previous) if (!present.has(id)) missing++;
	return missing;
}

function boundedIncrement(value: number, amount: number): number {
	return Math.min(MAX_COUNTER, value + Math.max(0, amount));
}

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function lerp(min: number, max: number, amount: number): number {
	return min + (max - min) * amount;
}

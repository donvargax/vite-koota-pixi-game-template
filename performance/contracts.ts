export type SchemaVersion = 1;

export type RecordSchema =
	| "scenario"
	| "build-manifest"
	| "environment"
	| "window"
	| "workload"
	| "comparison"
	| "evidence";

export type MeasurementMode = "clean" | "cpu-trace" | "allocation";

export type ScenarioCategory =
	| "idle"
	| "movement"
	| "firing"
	| "stress"
	| "lifecycle"
	| "self-test";

export type ScenarioMembership = {
	readonly fast: boolean;
	readonly full: boolean;
	readonly baseline: boolean;
};

export type InputEventKind = "keydown" | "keyup";

export interface InputEventDeclaration {
	readonly atMs: number;
	readonly kind: InputEventKind;
	readonly key: string;
}

export interface InputSchedule {
	readonly origin: "sample-start";
	readonly events: readonly InputEventDeclaration[];
	readonly maxLatenessMs: number;
	readonly heldKeys: readonly string[];
}

export type AudioPolicy = "representative" | "synthetic-counting" | "disabled";

export interface LayoutDefinition {
	readonly version: string;
	readonly pattern: string;
	readonly worldMinX: number;
	readonly worldMaxX: number;
	readonly groundY: number;
	readonly boltUpperLaneY: number;
	readonly boltGroundLaneY: number;
}

export interface PopulationTargets {
	readonly foes: number;
	readonly bolts: number;
	readonly upperLaneBoltRatio: number;
	readonly finiteBoltLifeSeconds: number;
	readonly boltVelocityMin: number;
	readonly boltVelocityMax: number;
	readonly boltDamage: number;
}

export interface ValidityEnvelope {
	readonly beforeSimulationFoes: number;
	readonly afterSimulationFoes: number;
	readonly afterMaintenanceFoes: number;
	readonly beforeSimulationBolts: number;
	readonly afterSimulationBolts: number;
	readonly afterMaintenanceBolts: number;
	readonly projectedVisibleBoltsMinimum: number;
	readonly hardPopulationCeiling: number;
	readonly minimumSimulationSeconds: number;
	readonly minimumWallSeconds: number;
	readonly minimumSuccessfulRenderCount: number;
}

export interface ScenarioDefinition {
	readonly schema: "scenario";
	readonly schemaVersion: SchemaVersion;
	readonly workloadVersion: string;
	readonly id: string;
	readonly category: ScenarioCategory;
	readonly seed: number;
	readonly targets: PopulationTargets;
	readonly layout: LayoutDefinition;
	readonly audio: AudioPolicy;
	readonly input: InputSchedule;
	readonly warmupMs: number;
	readonly sampleMs: number;
	readonly repetitions: number;
	readonly membership: ScenarioMembership;
	readonly validity: ValidityEnvelope;
}

export interface WorkloadDeclaration {
	readonly scenarioId: string;
	readonly seed: number;
	readonly targetFoes: number;
	readonly targetBolts: number;
	readonly projectedVisibleBoltsMinimum: number;
	readonly hardPopulationCeiling: number;
	readonly layoutVersion: string;
	readonly pattern: string;
	readonly audio: AudioPolicy;
	readonly input: InputSchedule;
	readonly warmupMs: number;
	readonly sampleMs: number;
	readonly repetitions: number;
	readonly workloadFingerprint: string;
}

export interface BuildManifest {
	readonly schema: "build-manifest";
	readonly schemaVersion: SchemaVersion;
	readonly buildId: string;
	readonly revision: string;
	readonly dirtySourceFingerprint: string | null;
	readonly workloadFingerprint: string;
	readonly optimizedEntryHash: string;
	readonly optimizedOutputHashes: Readonly<Record<string, string>>;
	readonly javascriptHashes: Readonly<Record<string, string>>;
	readonly sourceMapHashes: Readonly<Record<string, string>>;
	readonly toolVersions: Readonly<Record<string, string>>;
}

export interface EnvironmentRecord {
	readonly schema: "environment";
	readonly schemaVersion: SchemaVersion;
	readonly nodeVersion: string;
	readonly playwrightVersion: string;
	readonly chromiumVersion: string;
	readonly os: string;
	readonly architecture: string;
	readonly cpuIdentity: string;
	readonly runnerClass: string | null;
	readonly localMachineKey: string | null;
	readonly renderer: string | null;
	readonly backend: string | null;
	readonly gpuIdentity: string | null;
	readonly headless: boolean;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly devicePixelRatio: number;
	readonly throttling: string;
	readonly audioPolicy: AudioPolicy;
	readonly pageVisible: boolean;
	readonly measuredIdleCadenceMs: number | null;
}

export interface BoundedSampleMetadata {
	readonly sampleCount: number;
	readonly maximumSamples: number;
	readonly truncated: boolean;
	readonly droppedSamples: number;
	readonly firstTimestampMs: number | null;
	readonly lastTimestampMs: number | null;
}

export interface NumericSamples {
	readonly values: readonly number[];
	readonly metadata: BoundedSampleMetadata;
}

export interface PhaseAggregate {
	readonly name: string;
	readonly samples: NumericSamples;
	readonly totalMs: number | null;
}

export interface InputTimingObservation {
	readonly scheduledAtMs: number;
	readonly deliveredAtMs: number | null;
	readonly latenessMs: number | null;
	readonly kind: InputEventKind;
	readonly key: string;
}

export interface CapabilityStatus {
	readonly supported: boolean;
	readonly reason: string | null;
}

export interface LongTaskObservation {
	readonly capability: CapabilityStatus;
	readonly count: number | null;
	readonly durationMs: number | null;
}

export interface CdpBoundaryObservation {
	readonly taskDurationMs: number | null;
	readonly heapUsedBytes: number | null;
	readonly taskDurationDeltaMs: number | null;
	readonly heapUsedDeltaBytes: number | null;
}

export interface RuntimeObservationPayload {
	readonly schema: "runtime-observation";
	readonly schemaVersion: SchemaVersion;
	readonly frame: NumericSamples;
	readonly callbackWork: NumericSamples;
	readonly phases: readonly PhaseAggregate[];
	readonly successfulRenderCount: number;
	readonly renderProgressCount: number;
	readonly longTasks: LongTaskObservation;
	readonly cdp: CdpBoundaryObservation;
	readonly checksum: number | null;
	readonly failures: readonly FailureVariant[];
}

export interface WindowRecord {
	readonly schema: "window";
	readonly schemaVersion: SchemaVersion;
	readonly scenarioId: string;
	readonly repetition: number;
	readonly mode: MeasurementMode;
	readonly monotonicStartMs: number;
	readonly monotonicEndMs: number;
	readonly actualElapsedMs: number;
	readonly requestedDurationMs: number;
	readonly inputTiming: readonly InputTimingObservation[];
	readonly rawRafSamples: NumericSamples;
	readonly frameCpuWorkSamples: NumericSamples;
	readonly phaseAggregates: readonly PhaseAggregate[];
	readonly longTasks: LongTaskObservation;
	readonly cdp: CdpBoundaryObservation;
	readonly capabilityStatuses: Readonly<Record<string, CapabilityStatus>>;
	readonly completion: "completed" | "cancelled" | "timeout" | "failed";
	readonly failures: readonly FailureVariant[];
}

export interface WorkloadRecord {
	readonly schema: "workload";
	readonly schemaVersion: SchemaVersion;
	readonly scenarioId: string;
	readonly repetition: number;
	readonly beforeSimulationFoes: number;
	readonly afterSimulationFoes: number;
	readonly afterMaintenanceFoes: number;
	readonly beforeSimulationBolts: number;
	readonly afterSimulationBolts: number;
	readonly afterMaintenanceBolts: number;
	readonly projectedOnScreenBolts: number;
	readonly spawnCount: number;
	readonly recycleCount: number;
	readonly removalCount: number;
	readonly hitCount: number;
	readonly foeDownCount: number;
	readonly simulationSeconds: number;
	readonly rawWallSeconds: number;
	readonly minimumLoad: number;
	readonly maximumLoad: number;
	readonly progressValid: boolean;
	readonly validityStatus: "valid" | "invalid" | "unsupported";
	readonly failures: readonly FailureVariant[];
}

export type VerdictStatus =
	| "passed"
	| "regression"
	| "capacity-failure"
	| "workload-invalid"
	| "unsupported"
	| "infrastructure-failure"
	| "unbaselined-collection";

export interface MetricStatus {
	readonly metric: string;
	readonly status: "passed" | "regression" | "missing" | "unsupported" | "invalid";
	readonly direction: "higher-is-better" | "lower-is-better" | "informational";
	readonly expected: number | null;
	readonly received: number | null;
	readonly delta: number | null;
	readonly relativeDelta: number | null;
	readonly reason: string | null;
}

export interface RepetitionSummary {
	readonly scenarioId: string;
	readonly repetition: number;
	readonly metrics: readonly MetricStatus[];
	readonly window: WindowRecord;
	readonly workload: WorkloadRecord;
}

export interface ComparisonRecord {
	readonly schema: "comparison";
	readonly schemaVersion: SchemaVersion;
	readonly mode: MeasurementMode;
	readonly expectedScenarioIds: readonly string[];
	readonly expectedRepetitions: Readonly<Record<string, number>>;
	readonly receivedCoverage: Readonly<Record<string, readonly number[]>>;
	readonly perRepetition: readonly RepetitionSummary[];
	readonly medianRepetitionAggregates: Readonly<
		Record<string, Readonly<Record<string, number | null>>>
	>;
	readonly baselineProvenance: string | null;
	readonly policyProvenance: string;
	readonly workloadFingerprint: string;
	readonly metricStatuses: readonly MetricStatus[];
	readonly status: VerdictStatus;
	readonly originalVerdict: VerdictStatus;
	readonly reasons: readonly string[];
}

export interface EvidenceRecord {
	readonly schema: "evidence";
	readonly schemaVersion: SchemaVersion;
	readonly scenarioId: string;
	readonly repetition: number;
	readonly mode: "cpu-trace" | "allocation";
	readonly status: "complete" | "unsupported" | "failed" | "truncated";
	readonly reproduction: "reproduced" | "not-reproduced" | "invalid" | "not-run";
	readonly supportedCapabilities: readonly string[];
	readonly missingCapabilities: readonly string[];
	readonly rawCpuPath: string | null;
	readonly rawTracePath: string | null;
	readonly rawAllocationPath: string | null;
	readonly buildMapLinkage: Readonly<Record<string, string>>;
	readonly mappedCpuSummary: readonly MappedCpuSample[];
	readonly observedEvents: readonly ObservedEventSummary[];
	readonly truncation: string | null;
	readonly errors: readonly string[];
}

export interface MappedCpuSample {
	readonly functionName: string;
	readonly sourceFile: string | null;
	readonly line: number | null;
	readonly column: number | null;
	readonly selfMs: number;
	readonly totalMs: number;
}

export interface ObservedEventSummary {
	readonly name: string;
	readonly category: string;
	readonly processId: number | null;
	readonly threadId: number | null;
	readonly durationMs: number;
	readonly overlapAwareDurationMs: number;
}

export type FailureKind =
	| "invalid-input"
	| "missing-required-metric"
	| "unsupported-capability"
	| "timeout"
	| "cancelled"
	| "dropped-samples"
	| "truncated"
	| "wrong-build"
	| "hidden-page"
	| "workload-invalid"
	| "infrastructure-error";

export interface FailureVariant {
	readonly kind: FailureKind;
	readonly phase: string;
	readonly message: string;
	readonly retryable: boolean;
}

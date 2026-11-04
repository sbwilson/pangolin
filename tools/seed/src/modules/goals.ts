// The seed's goals, stages, and rules (AD-15, CAP-6, CAP-7).
import type { Json, SeedModule } from "../module.ts";
import type {
  GoalCreatedEvent,
  GoalRuleCreatedEvent,
  SeedEvent,
  StageCreatedEvent,
  World,
} from "../world.ts";
import { PERSON_KEYS } from "./people-and-household.ts";

const [A, B] = PERSON_KEYS;

export const GOAL_KEYS = {
  rainyDay: "goal-rainy-day",
  houseDeposit: "goal-house-deposit",
  japanTrip: "goal-japan-trip",
  newCouch: "goal-new-couch",
} as const;

export const STAGE_KEYS = {
  stage1: "stage-emergency-fund",
  stage2: "stage-build",
} as const;

export const GOAL_RULE_KEYS = {
  stage1RainyDay: "rule-stage1-rainy-day",
  stage1HouseDeposit: "rule-stage1-house-deposit",
  stage1JapanTrip: "rule-stage1-japan-trip",
  stage2HouseDeposit: "rule-stage2-house-deposit",
  stage2JapanTrip: "rule-stage2-japan-trip",
} as const;

export const goalsAndSavings: SeedModule = {
  name: "goals-and-savings",
  dependsOn: ["budgets-and-bills"],
  generate(world: World): { events: readonly SeedEvent[]; expectations: Record<string, Json> } {
    // 1. Goals
    // Goal 1: Rainy day emergency fund (Shared, emergency fund, target $20,000 / 2_000_000 cents, kind protected)
    const rainyDayGoal: GoalCreatedEvent = {
      type: "goal.created",
      key: GOAL_KEYS.rainyDay,
      person: null, // shared
      name: "Rainy day emergency fund",
      targetCents: 2_000_000,
      targetDate: null,
      priority: 1,
      kind: "protected",
      isEmergencyFund: true,
    };

    // Goal 2: House deposit (Shared, target $100,000 / 10_000_000 cents, targetDate 2028-12-31, kind protected)
    const houseDepositGoal: GoalCreatedEvent = {
      type: "goal.created",
      key: GOAL_KEYS.houseDeposit,
      person: null, // shared
      name: "House deposit",
      targetCents: 10_000_000,
      targetDate: "2028-12-31",
      priority: 2,
      kind: "protected",
      isEmergencyFund: false,
    };

    // Goal 3: Japan trip 2027 (Shared, target $8,000 / 800_000 cents, targetDate 2027-04-01, kind flexible)
    const japanTripGoal: GoalCreatedEvent = {
      type: "goal.created",
      key: GOAL_KEYS.japanTrip,
      person: null, // shared
      name: "Japan trip 2027",
      targetCents: 800_000,
      targetDate: "2027-04-01",
      priority: 3,
      kind: "flexible",
      isEmergencyFund: false,
    };

    // Goal 4: New couch (Person A personal goal, target $2,500 / 250_000 cents, kind flexible)
    const newCouchGoal: GoalCreatedEvent = {
      type: "goal.created",
      key: GOAL_KEYS.newCouch,
      person: A,
      name: "New couch",
      targetCents: 250_000,
      targetDate: "2026-11-30",
      priority: 1,
      kind: "flexible",
      isEmergencyFund: false,
    };

    // 2. Allocation Stages
    // Stage 1: "Emergency fund first" (sort 1, exitGoal: rainyDay, fallbackThreshold: 8000 bp / 80%)
    const stage1: StageCreatedEvent = {
      type: "stage.created",
      key: STAGE_KEYS.stage1,
      person: null, // shared
      name: "Stage 1: Emergency fund first",
      sort: 1,
      exitGoal: GOAL_KEYS.rainyDay,
      fallbackThresholdBp: 8000,
      completedSharePolicy: "rescale",
    };

    // Stage 2: "Build" (sort 2, exitGoal: houseDeposit)
    const stage2: StageCreatedEvent = {
      type: "stage.created",
      key: STAGE_KEYS.stage2,
      person: null, // shared
      name: "Stage 2: Build",
      sort: 2,
      exitGoal: GOAL_KEYS.houseDeposit,
      fallbackThresholdBp: 8000,
      completedSharePolicy: "rescale",
    };

    // 3. Goal Rules
    // Stage 1: 80% Emergency fund (8000 bp), 10% House deposit (1000 bp), 10% Japan trip (1000 bp)
    const rule1: GoalRuleCreatedEvent = {
      type: "goal-rule.created",
      key: GOAL_RULE_KEYS.stage1RainyDay,
      goal: GOAL_KEYS.rainyDay,
      stage: STAGE_KEYS.stage1,
      shareBp: 8000,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      source: "rule",
    };

    const rule2: GoalRuleCreatedEvent = {
      type: "goal-rule.created",
      key: GOAL_RULE_KEYS.stage1HouseDeposit,
      goal: GOAL_KEYS.houseDeposit,
      stage: STAGE_KEYS.stage1,
      shareBp: 1000,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      source: "rule",
    };

    const rule3: GoalRuleCreatedEvent = {
      type: "goal-rule.created",
      key: GOAL_RULE_KEYS.stage1JapanTrip,
      goal: GOAL_KEYS.japanTrip,
      stage: STAGE_KEYS.stage1,
      shareBp: 1000,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      source: "rule",
    };

    // Stage 2: 60% House deposit (6000 bp), 40% Japan trip (4000 bp)
    const rule4: GoalRuleCreatedEvent = {
      type: "goal-rule.created",
      key: GOAL_RULE_KEYS.stage2HouseDeposit,
      goal: GOAL_KEYS.houseDeposit,
      stage: STAGE_KEYS.stage2,
      shareBp: 6000,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      source: "rule",
    };

    const rule5: GoalRuleCreatedEvent = {
      type: "goal-rule.created",
      key: GOAL_RULE_KEYS.stage2JapanTrip,
      goal: GOAL_KEYS.japanTrip,
      stage: STAGE_KEYS.stage2,
      shareBp: 4000,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      source: "rule",
    };

    const events: SeedEvent[] = [
      rainyDayGoal,
      houseDepositGoal,
      japanTripGoal,
      newCouchGoal,
      stage1,
      stage2,
      rule1,
      rule2,
      rule3,
      rule4,
      rule5,
    ];

    return {
      events,
      expectations: {
        "goals.rainyDay": {
          key: rainyDayGoal.key,
          targetCents: rainyDayGoal.targetCents,
          isEmergencyFund: rainyDayGoal.isEmergencyFund,
        },
        "goals.houseDeposit": {
          key: houseDepositGoal.key,
          targetCents: houseDepositGoal.targetCents,
        },
        "goals.activeStage": {
          key: stage1.key,
          name: stage1.name,
        },
      },
    };
  },
};

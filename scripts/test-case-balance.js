'use strict';

const assert = require('node:assert/strict');
const { CASES } = require('../catalog.json');
const { POLICY, GROUPS, RARITY_GROUP, getCaseDistribution, pickCaseItem } = require('../lib/case-balance');
const EPSILON = 1e-9;
function almostEqual(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= EPSILON,
    `${message}: expected ${expected}, received ${actual}`);
}

assert.equal(CASES.length, 38);
assert.deepEqual(POLICY.basePercentages, {
  milSpec: 79.92, restricted: 15.98, classified: 3.2, covert: 0.64, special: 0.26
});
almostEqual(POLICY.targetReturnRate, 0.85, 'public target RTP');
almostEqual(GROUPS.reduce((sum, group) => sum + group.weight, 0), 1, 'rarity weights sum to 100%');

let calibrated = 0;
for (const definition of CASES) {
  const before = JSON.stringify(definition);
  const distribution = getCaseDistribution(definition);
  assert.strictEqual(distribution, getCaseDistribution(definition), `${definition.name}: cached, deterministic policy`);
  assert.ok(Object.isFrozen(distribution) && Object.isFrozen(distribution.items));
  assert.equal(distribution.items.length, definition.pool.length);
  assert.equal(distribution.probabilities.length, definition.pool.length);
  almostEqual(distribution.probabilities.reduce((a, b) => a + b, 0), 1, `${definition.name}: item chances sum to 100%`);
  almostEqual(distribution.cumulativeWeights.at(-1), 1, `${definition.name}: roulette ends at 100%`);
  assert.ok(distribution.probabilities.every(value => Number.isFinite(value) && value > 0),
    `${definition.name}: every listed item has a real, positive chance`);

  const groupCounts = new Map(GROUPS.map(group => [group.id, 0]));
  const rarityCounts = new Map();
  for (const item of definition.pool) {
    assert.ok(Object.hasOwn(RARITY_GROUP, item.r), `${definition.name}: unknown rarity ${item.r}`);
    groupCounts.set(RARITY_GROUP[item.r], groupCounts.get(RARITY_GROUP[item.r]) + 1);
    rarityCounts.set(item.r, (rarityCounts.get(item.r) || 0) + 1);
  }
  const presentWeight = GROUPS.filter(group => groupCounts.get(group.id) > 0)
    .reduce((sum, group) => sum + group.weight, 0);
  for (const group of GROUPS) {
    const expectedBaseline = groupCounts.get(group.id) ? group.weight / presentWeight : 0;
    almostEqual(distribution.baselineGroupProbabilities[group.id], expectedBaseline,
      `${definition.name}: published ${group.id} baseline`);
  }
  const baseExpectedValue = definition.pool.reduce((sum, item, index) => {
    const group = GROUPS.find(entry => entry.id === RARITY_GROUP[item.r]);
    const expectedBaselineItem = group.weight / presentWeight / groupCounts.get(group.id);
    almostEqual(distribution.baselineProbabilities[index], expectedBaselineItem,
      `${definition.name}: baseline chance for ${item.n}`);
    return sum + item.p * distribution.baselineProbabilities[index];
  }, 0);
  almostEqual(distribution.baseExpectedValue, baseExpectedValue, `${definition.name}: uncalibrated expected payout`);
  const expectedValue = definition.pool.reduce((sum, item, index) => sum + item.p * distribution.probabilities[index], 0);
  almostEqual(distribution.expectedValue, expectedValue, `${definition.name}: disclosed expected payout`);
  almostEqual(distribution.returnRate, expectedValue / definition.price, `${definition.name}: expected return rate`);
  almostEqual(distribution.returnRate, POLICY.targetReturnRate, `${definition.name}: 85% target expected return`);
  almostEqual(distribution.targetReturnRate, POLICY.targetReturnRate, `${definition.name}: disclosed calibrated target`);
  assert.equal(distribution.calibratedForPrice, Math.abs(baseExpectedValue / definition.price - POLICY.targetReturnRate) > EPSILON,
    `${definition.name}: price calibration flag`);
  if (distribution.calibratedForPrice) calibrated += 1;
  assert.equal(JSON.stringify(definition), before, `${definition.name}: distribution builder must not mutate the catalogue`);

  // Opening ten times cannot change the next roll or the published distribution.
  for (let count = 0; count < 10; count += 1) {
    assert.strictEqual(getCaseDistribution(definition), distribution);
    const previous = Math.random;
    try {
      Math.random = () => 0.125;
      assert.ok(definition.pool.includes(pickCaseItem(definition)));
    } finally { Math.random = previous; }
  }
}
assert.ok(calibrated > 0, 'the fixture must exercise price-aware calibration');
console.log(`Case odds checks passed: ${CASES.length} cases calibrated to ${POLICY.targetReturnRate * 100}% expected return; ${calibrated} item pools adjusted from rarity baseline.`);
console.log('All item chances remain positive and public; no per-user settings, streak bonuses, or batch-size modifiers.');

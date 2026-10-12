import test from 'node:test';
import assert from 'node:assert/strict';
import { getTimePeriod, periodFromSun } from './weather';

const RISE = 5 * 60 + 40;
const SET = 17 * 60 + 37;
const at = (hour: number, minute = 0) => periodFromSun(hour * 60 + minute, RISE, SET);

test('sunrise and sunset determine sky periods', () => {
  assert.equal(at(3), 'night');
  assert.equal(at(5, 20), 'morning');
  assert.equal(at(7), 'morning');
  assert.equal(at(8), 'day');
  assert.equal(at(12), 'day');
  assert.equal(at(17), 'day');
  assert.equal(at(17, 15), 'sunset');
  assert.equal(at(17, 50), 'sunset');
  assert.equal(at(18, 22), 'night');
  assert.equal(at(23), 'night');
});

test('sun-based sky periods transition in order', () => {
  const order = ['night', 'morning', 'day', 'sunset', 'night'];
  let index = 0;
  let previous = at(0);
  for (let minute = 1; minute < 24 * 60; minute++) {
    const period = periodFromSun(minute, RISE, SET);
    if (period !== previous) {
      index++;
      assert.equal(period, order[index], `at minute ${minute}`);
      previous = period;
    }
  }
  assert.equal(index, 4);
});

test('uses local clock when sun data is absent and location offset when present', () => {
  assert.equal(getTimePeriod(new Date(2026, 9, 6, 17, 0)).period, 'day');
  assert.equal(getTimePeriod(new Date(2026, 9, 6, 18, 22)).period, 'sunset');
  const placeTime = { rise: RISE, set: SET, offset: 8 * 3600 };
  assert.equal(getTimePeriod(new Date(Date.UTC(2026, 9, 6, 9, 0)), placeTime).period, 'day');
  assert.equal(getTimePeriod(new Date(Date.UTC(2026, 9, 6, 11, 0)), placeTime).isNight, true);
});
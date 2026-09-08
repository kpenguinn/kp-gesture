import { expect, test } from "bun:test";
import { GazeEstimator } from "../src/gaze-estimator.js";

function landmarksForEyeRatios(rightRatio, leftRatio, yRatio = 0.5) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));

  landmarks[33] = { x: 0.1, y: 0.5 };
  landmarks[133] = { x: 0.3, y: 0.5 };
  landmarks[159] = { x: 0.2, y: 0.45 };
  landmarks[145] = { x: 0.2, y: 0.55 };

  landmarks[362] = { x: 0.7, y: 0.5 };
  landmarks[263] = { x: 0.9, y: 0.5 };
  landmarks[386] = { x: 0.8, y: 0.45 };
  landmarks[374] = { x: 0.8, y: 0.55 };

  const rightIris = { x: 0.1 + rightRatio * 0.2, y: 0.45 + yRatio * 0.1 };
  const leftIris = { x: 0.7 + leftRatio * 0.2, y: 0.45 + yRatio * 0.1 };

  for (const index of [468, 469, 470, 471, 472]) {
    landmarks[index] = rightIris;
  }

  for (const index of [473, 474, 475, 476, 477]) {
    landmarks[index] = leftIris;
  }

  return landmarks;
}

test("projects centered irises to the center of the screen", () => {
  const estimator = new GazeEstimator({ smoothing: 1 });
  const point = estimator.estimate(landmarksForEyeRatios(0.5, 0.5));

  expect(point.x).toBeCloseTo(0.5);
  expect(point.y).toBeCloseTo(0.5);
});

test("projects horizontal eye movement with inverted camera mapping", () => {
  const estimator = new GazeEstimator({ smoothing: 1 });
  const point = estimator.estimate(landmarksForEyeRatios(0.7, 0.7));

  expect(point.x).toBeLessThan(0.1);
  expect(point.y).toBeCloseTo(0.5);
});

test("supports non-inverted horizontal projection", () => {
  const estimator = new GazeEstimator({ smoothing: 1, invertX: false });
  const point = estimator.estimate(landmarksForEyeRatios(0.7, 0.7));

  expect(point.x).toBeGreaterThan(0.9);
});

test("can learn a calibrated horizontal mapping", () => {
  const estimator = new GazeEstimator({ smoothing: 1 });
  estimator.addCalibrationPoint({ x: 0.1, y: 0.5 }, { x: 0.7, y: 0.5 });
  estimator.addCalibrationPoint({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
  estimator.addCalibrationPoint({ x: 0.9, y: 0.5 }, { x: 0.3, y: 0.5 });

  const point = estimator.estimate(landmarksForEyeRatios(0.3, 0.3));

  expect(point.x).toBeGreaterThan(0.85);
});

test("recenters around the latest eye position", () => {
  const estimator = new GazeEstimator({ smoothing: 1 });
  estimator.estimate(landmarksForEyeRatios(0.6, 0.6));

  expect(estimator.recenter()).toBe(true);

  const point = estimator.estimate(landmarksForEyeRatios(0.6, 0.6));
  expect(point.x).toBeCloseTo(0.5);
  expect(point.y).toBeCloseTo(0.5);
});

test("returns null when iris landmarks are unavailable", () => {
  const estimator = new GazeEstimator();

  expect(estimator.estimate([{ x: 0, y: 0 }])).toBeNull();
});

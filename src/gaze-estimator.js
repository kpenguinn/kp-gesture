const RIGHT_EYE = {
  corners: [33, 133],
  topBottom: [159, 145],
  iris: [468, 469, 470, 471, 472]
};

const LEFT_EYE = {
  corners: [362, 263],
  topBottom: [386, 374],
  iris: [473, 474, 475, 476, 477]
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function clampSlope(value) {
  const sign = Math.sign(value) || 1;
  const magnitude = Math.min(12, Math.max(0.5, Math.abs(value)));
  return sign * magnitude;
}

function averagePoint(landmarks, indexes) {
  const point = indexes.reduce((acc, index) => {
    const landmark = landmarks[index];
    acc.x += landmark.x;
    acc.y += landmark.y;
    return acc;
  }, { x: 0, y: 0 });

  return {
    x: point.x / indexes.length,
    y: point.y / indexes.length
  };
}

function eyeRatio(landmarks, eye) {
  const iris = averagePoint(landmarks, eye.iris);
  const cornerA = landmarks[eye.corners[0]];
  const cornerB = landmarks[eye.corners[1]];
  const top = landmarks[eye.topBottom[0]];
  const bottom = landmarks[eye.topBottom[1]];
  const minX = Math.min(cornerA.x, cornerB.x);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const minY = Math.min(top.y, bottom.y);
  const maxY = Math.max(top.y, bottom.y);

  return {
    x: clamp((iris.x - minX) / Math.max(0.001, maxX - minX)),
    y: clamp((iris.y - minY) / Math.max(0.001, maxY - minY))
  };
}

function averageRaw(samples) {
  const total = samples.reduce((acc, sample) => {
    acc.x += sample.x;
    acc.y += sample.y;
    return acc;
  }, { x: 0, y: 0 });

  return {
    x: total.x / samples.length,
    y: total.y / samples.length
  };
}

function fitAxis(samples, rawKey, targetKey) {
  if (samples.length < 2) {
    return null;
  }

  const rawMean = samples.reduce((sum, sample) => sum + sample.raw[rawKey], 0) / samples.length;
  const targetMean = samples.reduce((sum, sample) => sum + sample.target[targetKey], 0) / samples.length;
  const numerator = samples.reduce((sum, sample) => {
    return sum + (sample.raw[rawKey] - rawMean) * (sample.target[targetKey] - targetMean);
  }, 0);
  const denominator = samples.reduce((sum, sample) => {
    return sum + (sample.raw[rawKey] - rawMean) ** 2;
  }, 0);

  if (denominator < 0.00001) {
    return null;
  }

  const slope = clampSlope(numerator / denominator);
  return {
    slope,
    intercept: targetMean - slope * rawMean
  };
}

export class GazeEstimator {
  constructor({
    horizontalGain = 5.2,
    verticalGain = 4.4,
    smoothing = 0.42,
    invertX = true,
    neutral = { x: 0.5, y: 0.5 }
  } = {}) {
    this.horizontalGain = horizontalGain;
    this.verticalGain = verticalGain;
    this.smoothing = smoothing;
    this.invertX = invertX;
    this.neutral = neutral;
    this.point = null;
    this.rawHistory = [];
    this.calibrationSamples = [];
    this.calibrationProfile = null;
  }

  reset() {
    this.point = null;
  }

  setTuning({ horizontalGain, verticalGain, smoothing, invertX } = {}) {
    if (horizontalGain !== undefined) {
      this.horizontalGain = horizontalGain;
    }

    if (verticalGain !== undefined) {
      this.verticalGain = verticalGain;
    }

    if (smoothing !== undefined) {
      this.smoothing = smoothing;
    }

    if (invertX !== undefined) {
      this.invertX = invertX;
    }
  }

  recenter() {
    const raw = this.getRecentRaw();
    if (!raw) {
      return false;
    }

    this.neutral = raw;
    this.calibrationSamples = [];
    this.calibrationProfile = null;
    return true;
  }

  calibrate() {
    return this.recenter();
  }

  clearCalibration() {
    this.calibrationSamples = [];
    this.calibrationProfile = null;
  }

  addCalibrationPoint(target, raw = this.getRecentRaw()) {
    if (!raw) {
      return false;
    }

    this.calibrationSamples.push({
      target: {
        x: clamp(target.x),
        y: clamp(target.y)
      },
      raw
    });

    this.updateCalibrationProfile();
    return true;
  }

  getRecentRaw(size = 8) {
    const samples = this.rawHistory.slice(-size);
    return samples.length ? averageRaw(samples) : null;
  }

  updateCalibrationProfile() {
    const x = fitAxis(this.calibrationSamples, "x", "x");
    const y = fitAxis(this.calibrationSamples, "y", "y");

    this.calibrationProfile = x || y ? { x, y } : null;
  }

  project(raw) {
    if (this.calibrationProfile) {
      const x = this.calibrationProfile.x
        ? this.calibrationProfile.x.slope * raw.x + this.calibrationProfile.x.intercept
        : 0.5 + (raw.x - this.neutral.x) * this.horizontalGain * (this.invertX ? -1 : 1);
      const y = this.calibrationProfile.y
        ? this.calibrationProfile.y.slope * raw.y + this.calibrationProfile.y.intercept
        : 0.5 + (raw.y - this.neutral.y) * this.verticalGain;

      return {
        x: clamp(x),
        y: clamp(y)
      };
    }

    return {
      x: clamp(0.5 + (raw.x - this.neutral.x) * this.horizontalGain * (this.invertX ? -1 : 1)),
      y: clamp(0.5 + (raw.y - this.neutral.y) * this.verticalGain)
    };
  }

  estimate(landmarks) {
    if (!landmarks || landmarks.length < 478) {
      this.reset();
      return null;
    }

    const right = eyeRatio(landmarks, RIGHT_EYE);
    const left = eyeRatio(landmarks, LEFT_EYE);
    const raw = {
      x: (right.x + left.x) / 2,
      y: (right.y + left.y) / 2
    };
    this.rawHistory.push(raw);
    this.rawHistory = this.rawHistory.slice(-30);

    const projected = this.project(raw);

    const smoothed = this.point
      ? {
          x: this.point.x + (projected.x - this.point.x) * this.smoothing,
          y: this.point.y + (projected.y - this.point.y) * this.smoothing
        }
      : projected;

    this.point = {
      ...smoothed,
      raw,
      eyes: { right, left }
    };

    return this.point;
  }
}

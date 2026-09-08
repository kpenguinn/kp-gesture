import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
import { GazeEstimator } from "./gaze-estimator.js";

const GESTURE_MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";
const FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const routes = [
  {
    title: "Overview",
    body: "The first navigation target is selected. Start the camera to control window actions with hand gestures."
  },
  {
    title: "Capture",
    body: "Webcam frames are processed locally by the browser while hand landmarks are tracked on the overlay."
  },
  {
    title: "Recognize",
    body: "Closed fist, open palm, and pointing up are mapped to macOS window actions."
  },
  {
    title: "Route",
    body: "Forward and back actions update this target list and are ready to connect to application navigation."
  }
];

const CALIBRATION_TARGETS = [
  { x: 0.5, y: 0.5 },
  { x: 0.16, y: 0.5 },
  { x: 0.84, y: 0.5 },
  { x: 0.5, y: 0.16 },
  { x: 0.5, y: 0.84 }
];

const elements = {
  video: document.querySelector("#webcam"),
  canvas: document.querySelector("#overlay"),
  gazePreview: document.querySelector("#gazePreview"),
  calibrationTarget: document.querySelector("#calibrationTarget"),
  calibrationStepLabel: document.querySelector("#calibrationStepLabel"),
  virtualCursor: document.querySelector("#virtualCursor"),
  cameraEmpty: document.querySelector("#cameraEmpty"),
  cameraButton: document.querySelector("#cameraButton"),
  cameraButtonText: document.querySelector("#cameraButtonText"),
  calibrateButton: document.querySelector("#calibrateButton"),
  fullCalibrationButton: document.querySelector("#fullCalibrationButton"),
  backButton: document.querySelector("#backButton"),
  forwardButton: document.querySelector("#forwardButton"),
  signal: document.querySelector("#signal"),
  signalText: document.querySelector("#signal strong"),
  routeTitle: document.querySelector("#routeTitle"),
  routeBody: document.querySelector("#routeBody"),
  progressFill: document.querySelector("#progressFill"),
  gestureLabel: document.querySelector("#gestureLabel"),
  movementLabel: document.querySelector("#movementLabel"),
  gazeLabel: document.querySelector("#gazeLabel"),
  cursorLabel: document.querySelector("#cursorLabel"),
  pageLabel: document.querySelector("#pageLabel"),
  historyList: document.querySelector("#historyList"),
  horizontalGain: document.querySelector("#horizontalGain"),
  horizontalGainValue: document.querySelector("#horizontalGainValue"),
  verticalGain: document.querySelector("#verticalGain"),
  verticalGainValue: document.querySelector("#verticalGainValue"),
  gazeSmoothing: document.querySelector("#gazeSmoothing"),
  gazeSmoothingValue: document.querySelector("#gazeSmoothingValue"),
  invertGazeX: document.querySelector("#invertGazeX")
};

const ctx = elements.canvas.getContext("2d");

const state = {
  vision: null,
  gestureRecognizer: null,
  faceLandmarker: null,
  stream: null,
  isRunning: false,
  lastVideoTime: -1,
  routeIndex: 0,
  lastDirection: "None",
  frameHandle: 0,
  gazeEstimator: new GazeEstimator(),
  latestGaze: null,
  actionCooldownUntil: 0,
  lastActionGesture: "None",
  isCalibrating: false,
  calibrationIndex: 0
};

function setSignal(kind, text) {
  elements.signal.className = `signal ${kind}`;
  elements.signalText.textContent = text;
}

function renderRoute() {
  const route = routes[state.routeIndex];
  elements.routeTitle.textContent = route.title;
  elements.routeBody.textContent = route.body;
  elements.progressFill.style.width = `${((state.routeIndex + 1) / routes.length) * 100}%`;
  elements.pageLabel.textContent = `${state.routeIndex + 1} / ${routes.length}`;
  elements.backButton.disabled = state.routeIndex === 0;
  elements.forwardButton.disabled = state.routeIndex === routes.length - 1;
}

function updateGazeTuning() {
  const horizontalGain = Number(elements.horizontalGain.value);
  const verticalGain = Number(elements.verticalGain.value);
  const smoothing = Number(elements.gazeSmoothing.value);
  const invertX = elements.invertGazeX.checked;

  state.gazeEstimator.setTuning({
    horizontalGain,
    verticalGain,
    smoothing,
    invertX
  });

  elements.horizontalGainValue.textContent = horizontalGain.toFixed(1);
  elements.verticalGainValue.textContent = verticalGain.toFixed(1);
  elements.gazeSmoothingValue.textContent = smoothing.toFixed(2);
}

function showCalibrationTarget() {
  const target = CALIBRATION_TARGETS[state.calibrationIndex];
  elements.calibrationTarget.classList.add("visible");
  elements.calibrationTarget.style.left = `${target.x * 100}%`;
  elements.calibrationTarget.style.top = `${target.y * 100}%`;
  elements.calibrationStepLabel.textContent = `${state.calibrationIndex + 1}`;
  elements.cursorLabel.textContent = `${state.calibrationIndex + 1} / ${CALIBRATION_TARGETS.length}`;
  setSignal("action", "Calibrate");
}

function hideCalibrationTarget() {
  state.isCalibrating = false;
  state.calibrationIndex = 0;
  elements.calibrationTarget.classList.remove("visible");
}

function beginCalibration() {
  state.gazeEstimator.clearCalibration();
  state.isCalibrating = true;
  state.calibrationIndex = 0;
  showCalibrationTarget();
}

function captureCalibrationPoint() {
  if (!state.isCalibrating) {
    beginCalibration();
    return;
  }

  const target = CALIBRATION_TARGETS[state.calibrationIndex];
  const didCapture = state.gazeEstimator.addCalibrationPoint(target);

  if (!didCapture) {
    elements.cursorLabel.textContent = "No gaze";
    return;
  }

  state.calibrationIndex += 1;

  if (state.calibrationIndex >= CALIBRATION_TARGETS.length) {
    hideCalibrationTarget();
    elements.cursorLabel.textContent = "Calibrated";
    setSignal(state.isRunning ? "ready" : "idle", state.isRunning ? "Tracking" : "Idle");
    return;
  }

  showCalibrationTarget();
}

function addHistory(direction, targetTitle) {
  const time = new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
  const item = document.createElement("div");
  item.className = "history-item";
  item.innerHTML = `
    <span class="history-dot"></span>
    <span>${direction} to ${targetTitle} · ${time}</span>
  `;
  if (elements.historyList.firstElementChild?.textContent?.includes("No navigation yet")) {
    elements.historyList.replaceChildren(item);
  } else {
    elements.historyList.prepend(item);
  }

  while (elements.historyList.children.length > 5) {
    elements.historyList.lastElementChild.remove();
  }
}

function navigate(direction, source = "button") {
  const nextIndex = direction === "Forward"
    ? Math.min(routes.length - 1, state.routeIndex + 1)
    : Math.max(0, state.routeIndex - 1);

  if (nextIndex === state.routeIndex) {
    return;
  }

  state.routeIndex = nextIndex;
  state.lastDirection = direction;
  elements.gestureLabel.textContent = source === "gesture" ? direction : "Manual";
  renderRoute();
  addHistory(direction, routes[state.routeIndex].title);
  setSignal("action", direction);

  window.setTimeout(() => {
    setSignal(state.isRunning ? "ready" : "idle", state.isRunning ? "Tracking" : "Idle");
  }, 700);
}

function resizeCanvasToVideo() {
  const width = elements.video.videoWidth || elements.video.clientWidth;
  const height = elements.video.videoHeight || elements.video.clientHeight;

  if (!width || !height) {
    return;
  }

  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
  }
}

function mirroredPoint(point) {
  return {
    x: (1 - point.x) * elements.canvas.width,
    y: point.y * elements.canvas.height
  };
}

function drawHand(landmarks) {
  if (!landmarks?.length) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, elements.canvas.width * 0.004);
  ctx.strokeStyle = "rgba(255, 253, 248, 0.88)";

  for (const [from, to] of HAND_CONNECTIONS) {
    const start = mirroredPoint(landmarks[from]);
    const end = mirroredPoint(landmarks[to]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  ctx.fillStyle = "#1f857f";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
  ctx.lineWidth = 2;

  for (const landmark of landmarks) {
    const point = mirroredPoint(landmark);
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(4, elements.canvas.width * 0.006), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawFaceFocus(faceLandmarks, gaze) {
  if (!faceLandmarks?.length || !gaze) {
    return;
  }

  const eyeIndexes = [33, 133, 159, 145, 362, 263, 386, 374, 468, 473];

  ctx.save();
  ctx.strokeStyle = "rgba(193, 154, 60, 0.88)";
  ctx.fillStyle = "rgba(193, 154, 60, 0.95)";
  ctx.lineWidth = Math.max(2, elements.canvas.width * 0.003);

  for (const index of eyeIndexes) {
    const landmark = faceLandmarks[index];
    if (!landmark) {
      continue;
    }

    const point = mirroredPoint(landmark);
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(3, elements.canvas.width * 0.004), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function setGazePreview(gaze) {
  if (!gaze) {
    elements.gazePreview.classList.remove("visible");
    elements.gazeLabel.textContent = "No face";
    return;
  }

  elements.gazePreview.classList.add("visible");
  elements.gazePreview.style.left = `${gaze.x * 100}%`;
  elements.gazePreview.style.top = `${gaze.y * 100}%`;
  elements.gazeLabel.textContent = `${Math.round(gaze.x * 100)}%, ${Math.round(gaze.y * 100)}%`;
}

function commitVirtualCursor(gaze, now, gestureCategory) {
  if (state.lastActionGesture === gestureCategory || now < state.actionCooldownUntil) {
    return;
  }

  state.lastActionGesture = gestureCategory;
  state.actionCooldownUntil = now + 1200;
  elements.movementLabel.textContent = "Minimize";

  if (gaze) {
    const x = `${gaze.x * 100}vw`;
    const y = `${gaze.y * 100}vh`;
    elements.virtualCursor.style.left = x;
    elements.virtualCursor.style.top = y;
    elements.virtualCursor.classList.add("active", "pulse");
    elements.cursorLabel.textContent = `${Math.round(gaze.x * 100)}%, ${Math.round(gaze.y * 100)}%`;
  } else {
    elements.cursorLabel.textContent = "No gaze";
  }

  setSignal("action", "Minimize");
  requestWindowAction("minimize-browser", "Minimize");

  window.setTimeout(() => {
    elements.virtualCursor.classList.remove("pulse");
    if (state.isRunning && performance.now() > state.actionCooldownUntil) {
      setSignal("ready", "Tracking");
    }
  }, 420);
}

async function requestWindowAction(action, label) {
  try {
    const response = await fetch("/api/window-action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action })
    });

    if (!response.ok) {
      elements.cursorLabel.textContent = `${label} blocked`;
    }
  } catch (error) {
    console.warn(error);
    elements.cursorLabel.textContent = `${label} unavailable`;
  }
}

function readGestureName(result) {
  const category = result.gestures?.[0]?.[0];
  if (!category || category.categoryName === "None") {
    return "Hand";
  }

  return category.categoryName.replaceAll("_", " ");
}

function readGestureCategory(result) {
  const category = result.gestures?.[0]?.[0];
  return category && category.score >= 0.5 ? category.categoryName : "None";
}

function triggerWindowAction(action, label, signalLabel, now, gestureCategory) {
  if (state.lastActionGesture === gestureCategory || now < state.actionCooldownUntil) {
    return false;
  }

  state.lastActionGesture = gestureCategory;
  state.actionCooldownUntil = now + 1200;
  elements.movementLabel.textContent = label;
  elements.cursorLabel.textContent = label;
  setSignal("action", signalLabel);
  requestWindowAction(action, label);

  window.setTimeout(() => {
    if (state.isRunning && performance.now() > state.actionCooldownUntil) {
      setSignal("ready", "Tracking");
    }
  }, 700);

  return true;
}

async function createVisionTasks() {
  if (state.gestureRecognizer && state.faceLandmarker) {
    return;
  }

  setSignal("idle", "Loading");
  state.vision = state.vision || await FilesetResolver.forVisionTasks(WASM_URL);
  state.gestureRecognizer = await GestureRecognizer.createFromOptions(state.vision, {
    baseOptions: {
      modelAssetPath: GESTURE_MODEL_URL,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  });
  state.faceLandmarker = await FaceLandmarker.createFromOptions(state.vision, {
    baseOptions: {
      modelAssetPath: FACE_MODEL_URL,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.55,
    minFacePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  });
}

async function startCamera() {
  elements.cameraButton.disabled = true;
  elements.cameraButtonText.textContent = "Starting";

  try {
    await createVisionTasks();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      },
      audio: false
    });

    elements.video.srcObject = state.stream;
    await elements.video.play();
    state.isRunning = true;
    state.lastVideoTime = -1;
    elements.cameraEmpty.classList.add("hidden");
    elements.cameraButtonText.textContent = "Stop camera";
    elements.cameraButton.disabled = false;
    setSignal("ready", "Tracking");
    loop();
  } catch (error) {
    console.error(error);
    elements.cameraButtonText.textContent = "Start camera";
    elements.cameraButton.disabled = false;
    setSignal("idle", "Blocked");
    elements.gestureLabel.textContent = "Camera unavailable";
  }
}

function stopCamera() {
  state.isRunning = false;
  window.cancelAnimationFrame(state.frameHandle);
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.gazeEstimator.reset();
  state.latestGaze = null;
  hideCalibrationTarget();
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  elements.video.srcObject = null;
  elements.cameraEmpty.classList.remove("hidden");
  elements.gazePreview.classList.remove("visible");
  elements.cameraButtonText.textContent = "Start camera";
  elements.gestureLabel.textContent = "None";
  elements.movementLabel.textContent = "None";
  elements.gazeLabel.textContent = "No face";
  setSignal("idle", "Idle");
}

function processFrame() {
  resizeCanvasToVideo();

  if (!state.gestureRecognizer || !state.faceLandmarker || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  if (elements.video.currentTime === state.lastVideoTime) {
    return;
  }

  state.lastVideoTime = elements.video.currentTime;

  const now = performance.now();
  const gestureResult = state.gestureRecognizer.recognizeForVideo(elements.video, now);
  const faceResult = state.faceLandmarker.detectForVideo(elements.video, now);
  const handLandmarks = gestureResult.landmarks?.[0];
  const faceLandmarks = faceResult.faceLandmarks?.[0];
  const gaze = state.gazeEstimator.estimate(faceLandmarks);
  const gestureCategory = readGestureCategory(gestureResult);

  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  state.latestGaze = gaze;
  setGazePreview(gaze);
  drawFaceFocus(faceLandmarks, gaze);

  if (!handLandmarks) {
    state.lastActionGesture = "None";
    elements.gestureLabel.textContent = "None";
    elements.movementLabel.textContent = "None";
    if (now > state.actionCooldownUntil) {
      setSignal("ready", "Tracking");
    }
    return;
  }

  drawHand(handLandmarks);
  elements.gestureLabel.textContent = readGestureName(gestureResult);

  if (gestureCategory === "Closed_Fist") {
    elements.gestureLabel.textContent = "Closed fist";
    commitVirtualCursor(state.latestGaze, now, gestureCategory);
    return;
  }

  if (gestureCategory === "Open_Palm") {
    triggerWindowAction("restore-browser", "Restore", "Restore", now, gestureCategory);
    return;
  }

  if (gestureCategory === "Pointing_Up") {
    triggerWindowAction("reveal-all-windows", "All windows", "Windows", now, gestureCategory);
    return;
  }

  state.lastActionGesture = "None";
  elements.movementLabel.textContent = "None";
}

function loop() {
  if (!state.isRunning) {
    return;
  }

  processFrame();
  state.frameHandle = window.requestAnimationFrame(loop);
}

elements.cameraButton.addEventListener("click", () => {
  if (state.isRunning) {
    stopCamera();
  } else {
    startCamera();
  }
});

elements.backButton.addEventListener("click", () => navigate("Back"));
elements.forwardButton.addEventListener("click", () => navigate("Forward"));
elements.calibrateButton.addEventListener("click", () => {
  elements.cursorLabel.textContent = state.gazeEstimator.recenter() ? "Recentered" : "No gaze";
});
elements.fullCalibrationButton.addEventListener("click", captureCalibrationPoint);
elements.calibrationTarget.addEventListener("click", captureCalibrationPoint);
elements.horizontalGain.addEventListener("input", updateGazeTuning);
elements.verticalGain.addEventListener("input", updateGazeTuning);
elements.gazeSmoothing.addEventListener("input", updateGazeTuning);
elements.invertGazeX.addEventListener("change", updateGazeTuning);
window.addEventListener("resize", resizeCanvasToVideo);

updateGazeTuning();
renderRoute();

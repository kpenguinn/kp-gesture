# kp-gesture

A static browser prototype for webcam-based hand gesture and gaze navigation.

## Run

```sh
bun run serve
```

Then open `http://localhost:8000`.

The app uses the browser camera permission prompt. It loads MediaPipe's pinned browser vision bundle from jsDelivr and the gesture recognizer model from Google's public model storage at runtime.

## Controls

- Look toward a point in the camera frame, then make a closed fist to move the in-app cursor to the estimated gaze target and minimize the browser window.
- Show an open palm to restore the last minimized browser window.
- Point upward to show all windows with macOS Mission Control.
- Use the crosshair button while looking straight ahead to recenter gaze tracking.
- Use the five-dot button to run five-point gaze calibration. Look at each target and click the target or five-dot button to capture it.
- Tune horizontal, vertical, smoothing, and X flip controls live if calibration still feels off.

Web pages cannot move the operating system cursor or minimize the browser directly, so this prototype renders a virtual cursor inside the page and asks the local Python server to minimize the front browser window on macOS.

## Test

```sh
bun test
```

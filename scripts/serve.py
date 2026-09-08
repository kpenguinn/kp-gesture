#!/usr/bin/env python3
import argparse
import http.server
import json
import socketserver
import subprocess


MINIMIZE_SCRIPT = """
tell application "System Events"
    set frontProcess to first application process whose frontmost is true
    set frontName to name of frontProcess
    if (count of windows of frontProcess) is greater than 0 then
        set value of attribute "AXMinimized" of window 1 of frontProcess to true
    end if
    return frontName
end tell
"""

RESTORE_SCRIPT = """
on run argv
    set preferredName to ""
    if (count of argv) is greater than 0 then set preferredName to item 1 of argv
    set browserNames to {"Safari", "Google Chrome", "Google Chrome Canary", "Brave Browser", "Microsoft Edge", "Firefox", "Arc"}
    if preferredName is not "" then set browserNames to {preferredName} & browserNames

    tell application "System Events"
        repeat with browserName in browserNames
            if exists application process browserName then
                tell application process browserName
                    set visible to true
                    repeat with appWindow in windows
                        try
                            if value of attribute "AXMinimized" of appWindow is true then
                                set value of attribute "AXMinimized" of appWindow to false
                                set frontmost to true
                                return browserName as text
                            end if
                        end try
                    end repeat

                    if preferredName is not "" and (browserName as text) is preferredName then
                        set frontmost to true
                        return browserName as text
                    end if
                end tell
            end if
        end repeat
    end tell

    return ""
end run
"""

REVEAL_ALL_WINDOWS_SCRIPT = """
tell application "System Events"
    key code 126 using control down
end tell
"""


class LocalServer(http.server.ThreadingHTTPServer):
    last_minimized_process = ""

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port


class GestureHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if not self.is_same_origin_request():
            self.send_error(403)
            return

        action = self.read_action()
        if action is None:
            self.send_error(404)
            return

        if action not in {"minimize-browser", "restore-browser", "reveal-all-windows"}:
            self.send_json(400, {"ok": False, "error": f"Unknown action: {action}"})
            return

        result = self.run_action(action)
        if action == "minimize-browser" and result.returncode == 0 and result.stdout.strip():
            self.server.last_minimized_process = result.stdout.strip()

        payload = {
            "ok": result.returncode == 0,
            "action": action,
            "error": result.stderr.strip()
        }
        if result.stdout.strip():
            payload["result"] = result.stdout.strip()
        self.send_json(200 if result.returncode == 0 else 500, payload)

    def read_action(self):
        if self.path == "/api/minimize-browser":
            return "minimize-browser"

        if self.path != "/api/window-action":
            return None

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return ""

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            return ""

        return payload.get("action", "")

    def run_action(self, action):
        if action == "minimize-browser":
            command = ["osascript", "-e", MINIMIZE_SCRIPT]
        elif action == "restore-browser":
            command = ["osascript", "-e", RESTORE_SCRIPT, self.server.last_minimized_process]
        else:
            command = ["osascript", "-e", REVEAL_ALL_WINDOWS_SCRIPT]

        try:
            return subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=3,
                check=False
            )
        except subprocess.TimeoutExpired:
            return subprocess.CompletedProcess(command, 124, "", "Timed out running window action")

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def is_same_origin_request(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True

        host, port = self.server.server_address[:2]
        allowed = {
            f"http://{host}:{port}",
            f"http://localhost:{port}",
            f"http://127.0.0.1:{port}"
        }
        return origin in allowed


def main():
    parser = argparse.ArgumentParser(description="Serve the gesture prototype locally.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()

    with LocalServer((args.host, args.port), GestureHandler) as server:
        print(f"Serving on http://{args.host}:{args.port}")
        server.serve_forever()


if __name__ == "__main__":
    main()

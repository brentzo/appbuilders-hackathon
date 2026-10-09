"""A passive client for the harness's local socket: one JSON-RPC 2.0 message per line.

It never says `hello`. The harness sends its calls to the Mac app (observeWindow, executeAction,
showApprovalCard, ...) to the most recent connection that said hello, so a client that said hello
would take the Mac app's place and break the run it is measuring. Without hello the harness still
answers its own methods (submitGoal, getTask, listTasks, cancelTask); it just sends no events, so
the runner follows a task by asking for it.
"""
import json
import socket


class HarnessError(Exception):
    """The harness answered with a JSON-RPC error."""

    def __init__(self, method, error):
        self.method = method
        self.code = error.get("code")
        self.data = error.get("data")
        super().__init__(f"{method} failed: {error.get('message')} {self.data or ''}".strip())


class HarnessClient:
    def __init__(self, socket_path, timeout=30.0):
        self.socket_path = socket_path
        self.timeout = timeout
        self.sock = None
        self.buffer = b""
        self.next_id = 1

    def __enter__(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)
        return self

    def __exit__(self, *exc):
        if self.sock:
            self.sock.close()
            self.sock = None

    def call(self, method, params):
        request_id = self.next_id
        self.next_id += 1
        message = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        self.sock.sendall((json.dumps(message) + "\n").encode())
        while True:
            reply = self._read_message()
            # Without hello nothing else should arrive, but skip anything that is not our answer.
            if reply.get("id") != request_id or "method" in reply:
                continue
            if "error" in reply:
                raise HarnessError(method, reply["error"])
            return reply.get("result")

    def _read_message(self):
        while b"\n" not in self.buffer:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("The harness closed the connection")
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b"\n", 1)
        return json.loads(line)

    # The methods the runner uses, with the protocol's parameter shapes (protocol/schemas/rpc.json).

    def submit_goal(self, transcript, auto_mode=True, origin="mac-local"):
        return self.call("submitGoal", {"transcript": transcript, "originDeviceId": origin, "autoMode": auto_mode})["taskId"]

    def get_task(self, task_id):
        return self.call("getTask", {"taskId": task_id})

    def list_tasks(self, limit=20):
        return self.call("listTasks", {"limit": limit})["tasks"]

    def cancel_task(self, task_id):
        return self.call("cancelTask", {"taskId": task_id})

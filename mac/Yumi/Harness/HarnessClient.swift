import Foundation
import OSLog
import YumiProtocol

/// Why a call to the harness did not return a result.
enum HarnessCallError: Error {
    /// The method ran and failed (JSON-RPC -32000). Show it with the error presenter.
    case failed(UserError)
    case notConnected
    case timedOut
    case connectionLost
    /// The harness answered with something the contract does not allow. Details are logged.
    case contractViolation

    /// What the user sees. Only `failed` carries a SPEC-11 kind; everything else is a fault in the
    /// link, which the user meets as the "Unexpected" copy.
    var userError: UserError {
        if case .failed(let error) = self { return error }
        return UserError(kind: .unexpected)
    }
}

/// The JSON-RPC client for the harness's local socket (protocol/README.md, "Local RPC").
///
/// It connects, says `hello` with this app's protocol version, checks it with `ping`, and keeps
/// pinging; when the link drops it reconnects with a growing delay. Events arrive on `events`.
/// Every result and event is decoded into its generated protocol type; anything that does not
/// decode is logged and dropped.
@MainActor
final class HarnessClient {
    enum LinkState: Equatable {
        case connecting
        /// `hello` and the first `ping` answered.
        case connected
        /// The harness speaks a different protocol version. Retrying cannot fix this.
        case incompatible
    }

    let socketPath: String
    private(set) var linkState: LinkState = .connecting {
        didSet { if linkState != oldValue { onLinkStateChange?(linkState) } }
    }
    var onLinkStateChange: ((LinkState) -> Void)?
    /// This Mac's bridge device id, from the `hello` answer (OBJ-64, OBJ-72.1). Called on every
    /// reconnect; later changes arrive with `bridgeStateChanged`.
    var onDeviceId: ((String) -> Void)?
    /// The local model's state from the `hello` answer, before the link turns connected (OBJ-46).
    /// Nil from a harness that does not report it. Later changes arrive as `modelStateChanged`.
    var onModelState: ((ModelState?) -> Void)?

    /// Every event from the harness, in order. One consumer.
    let events: AsyncStream<HarnessEvent>
    private let eventContinuation: AsyncStream<HarnessEvent>.Continuation

    private var socket: LineSocket?
    /// Serves the methods the harness calls on the app (OBJ-27). Set before `start()`.
    var appMethods: AppMethodServer?
    private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
    private var nextId = 1
    private var running = false
    private var connectTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var failedAttempts = 0
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "rpc")

    /// How long calls and pings may take. Tests against a mock on a busy machine pass longer ones,
    /// so how fast the machine is cannot decide whether they pass.
    struct Timing: Sendable {
        var callTimeout: Duration = .seconds(10)
        var pingInterval: Duration = .seconds(5)
        var pingTimeout: Duration = .seconds(3)
    }

    let timing: Timing
    static let reconnectDelays: [Duration] = [.milliseconds(250), .milliseconds(500), .seconds(1), .seconds(2)]

    init(socketPath: String = HarnessSocket.defaultPath, timing: Timing = Timing()) {
        self.socketPath = socketPath
        self.timing = timing
        (events, eventContinuation) = AsyncStream.makeStream(bufferingPolicy: .bufferingNewest(256))
    }

    func start() {
        guard !running else { return }
        running = true
        connectLoop()
    }

    func stop() {
        running = false
        connectTask?.cancel()
        pingTask?.cancel()
        socket?.close()
        socket = nil
        failPending(.connectionLost)
        eventContinuation.finish()
    }

    // MARK: Calls

    func hello() async throws -> HelloResult {
        try await call(.hello, HelloParams(protocolVersion: PROTOCOL_VERSION), returning: HelloResult.self)
    }

    func ping(timeout: Duration? = nil) async throws {
        _ = try await call(.ping, Empty(), returning: Empty.self, timeout: timeout)
    }

    func submitGoal(_ params: SubmitGoalParams) async throws -> SubmitGoalResult {
        try await call(.submitGoal, params, returning: SubmitGoalResult.self)
    }

    func cancelTask(_ taskId: String) async throws {
        _ = try await call(.cancelTask, TaskRef(taskId: taskId), returning: Empty.self)
    }

    /// Calls a harness method. Params and result are generated protocol types.
    func call<Params: Encodable & Sendable, Result: Decodable>(
        _ method: RpcMethod,
        _ params: Params,
        returning: Result.Type,
        timeout: Duration? = nil
    ) async throws -> Result {
        let timeout = timeout ?? timing.callTimeout
        guard let socket else { throw HarnessCallError.notConnected }
        let id = nextId
        nextId += 1
        let message: Data
        do {
            message = try JSONEncoder().encode(RpcRequest(id: id, method: method.rawValue, params: params))
        } catch {
            log.error("Could not encode \(method.rawValue, privacy: .public): \(error.localizedDescription, privacy: .public)")
            throw HarnessCallError.contractViolation
        }
        let timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: timeout)
            guard !Task.isCancelled else { return }
            self?.resolve(id, with: .failure(HarnessCallError.timedOut))
        }
        defer { timeoutTask.cancel() }
        let resultData = try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            socket.send(message)
        }
        do {
            return try JSONDecoder().decode(Result.self, from: resultData)
        } catch {
            log.error("\(method.rawValue, privacy: .public) returned a result that does not match the contract: \(error.localizedDescription, privacy: .public)")
            throw HarnessCallError.contractViolation
        }
    }

    // MARK: Connection

    private func connectLoop() {
        connectTask?.cancel()
        connectTask = Task {
            while running, socket == nil, !Task.isCancelled {
                linkState = .connecting
                if await connectOnce() { return }
                let delay = Self.reconnectDelays[min(failedAttempts, Self.reconnectDelays.count - 1)]
                failedAttempts += 1
                try? await Task.sleep(for: delay)
            }
        }
    }

    /// Connects and shakes hands. Returns true when the link is up.
    private func connectOnce() async -> Bool {
        let path = socketPath
        let connected: LineSocket
        do {
            connected = try await Task.detached {
                try LineSocket.connect(
                    path: path,
                    onLine: { [weak self = self] socket, line in self?.receive(line, from: socket) },
                    onClose: { [weak self = self] socket in self?.connectionClosed(socket) }
                )
            }.value
        } catch {
            if failedAttempts == 0 {
                log.info("Harness socket not reachable yet: \(String(describing: error), privacy: .public)")
            }
            return false
        }
        // Current before reading starts, so a line sent right on connect is not dropped as coming
        // from a replaced socket.
        socket = connected
        connected.startReading()
        do {
            let hello = try await hello()
            guard hello.protocolVersion == PROTOCOL_VERSION else {
                log.error("The harness speaks protocol \(hello.protocolVersion), this app speaks \(PROTOCOL_VERSION); not connecting")
                linkState = .incompatible
                running = false
                connected.close()
                return true
            }
            if let deviceId = hello.deviceId { onDeviceId?(deviceId) }
            onModelState?(hello.modelState)
            try await ping()
        } catch {
            log.error("Handshake with the harness failed: \(String(describing: error), privacy: .public)")
            connected.close()
            if socket === connected { socket = nil }
            return false
        }
        failedAttempts = 0
        linkState = .connected
        log.notice("Connected to the harness: hello and ping answered")
        startPinging()
        return true
    }

    private func startPinging() {
        pingTask?.cancel()
        pingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: timing.pingInterval)
                guard !Task.isCancelled, socket != nil else { return }
                do {
                    try await ping(timeout: timing.pingTimeout)
                } catch {
                    log.error("Harness stopped answering ping: \(String(describing: error), privacy: .public)")
                    socket?.close()
                    return
                }
            }
        }
    }

    /// Only the current socket's close matters. A socket already replaced (a failed handshake, or a
    /// close that arrives after reconnecting) must not tear down the new link.
    private func connectionClosed(_ closed: LineSocket) {
        guard let current = socket, current === closed else { return }
        log.notice("Lost the link to the harness; reconnecting")
        socket = nil
        pingTask?.cancel()
        failPending(.connectionLost)
        if running {
            linkState = .connecting
            connectLoop()
        }
    }

    // MARK: Incoming

    private func receive(_ line: Data, from source: LineSocket) {
        // Lines from a socket already replaced are dropped: its calls were already failed, and its
        // events belong to a link that is gone.
        guard source === socket else { return }
        guard let message = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else {
            log.error("The harness sent a line that is not a JSON object")
            return
        }
        let id = message["id"] as? Int
        if let method = message["method"] as? String {
            if let id {
                answerRequest(id: id, method: method, params: message["params"], on: source)
            } else {
                receiveEvent(method, params: message["params"])
            }
            return
        }
        guard let id else { return }
        if let error = message["error"] as? [String: Any] {
            let code = error["code"] as? Int ?? 0
            let text = error["message"] as? String ?? ""
            log.error("Harness call \(id) failed with \(code): \(text, privacy: .public)")
            if code == RpcErrorCode.failed {
                let data = error["data"].flatMap { try? JSONSerialization.data(withJSONObject: $0) }
                resolve(id, with: .failure(HarnessCallError.failed(UserErrorDecoding.decode(data))))
            } else {
                resolve(id, with: .failure(HarnessCallError.contractViolation))
            }
            return
        }
        let result = message["result"] ?? [String: Any]()
        guard let data = try? JSONSerialization.data(withJSONObject: result, options: .fragmentsAllowed) else {
            resolve(id, with: .failure(HarnessCallError.contractViolation))
            return
        }
        resolve(id, with: .success(data))
    }

    private func receiveEvent(_ name: String, params: Any?) {
        do {
            let payload = try JSONSerialization.data(withJSONObject: params ?? [String: Any](), options: .fragmentsAllowed)
            let event = try HarnessEvent.decode(name: name, payload: payload)
            log.info("Event \(name, privacy: .public)")
            eventContinuation.yield(event)
        } catch {
            log.error("Dropped event \(name, privacy: .public): it does not match the contract (\(String(describing: error), privacy: .public))")
        }
    }

    /// Harness-to-app methods go to `appMethods` (OBJ-27). Without one, or for a method it does not
    /// serve, the app answers -32601, which the contract allows.
    private func answerRequest(id: Int, method: String, params: Any?, on source: LineSocket) {
        let paramsData = (try? JSONSerialization.data(withJSONObject: params ?? [String: Any](), options: .fragmentsAllowed)) ?? Data("{}".utf8)
        Task { [weak self, appMethods] in
            let reply = await appMethods?.serve(method, params: paramsData) ?? .notServed
            guard let self else { return }
            var message: [String: Any] = ["jsonrpc": "2.0", "id": id]
            switch reply {
            case .result(let data):
                message["result"] = (try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)) ?? [String: Any]()
            case .notServed:
                log.notice("The harness called \(method, privacy: .public), which this app does not serve yet")
                message["error"] = ["code": RpcErrorCode.methodNotFound, "message": "Method not found: \(method)"]
            case .invalidParams(let detail):
                log.error("The harness called \(method, privacy: .public) with params that break the contract: \(detail, privacy: .public)")
                message["error"] = ["code": RpcErrorCode.invalidParams, "message": "Invalid params for \(method)"]
            case .failed(let userError, let detail):
                log.error("\(method, privacy: .public) failed: \(detail, privacy: .public)")
                var error: [String: Any] = ["code": RpcErrorCode.failed, "message": detail]
                if let data = try? JSONEncoder().encode(userError) {
                    error["data"] = try? JSONSerialization.jsonObject(with: data)
                }
                message["error"] = error
            }
            // Answer on the socket the request came in on; a reply to a replaced socket is dropped.
            guard source === socket, let line = try? JSONSerialization.data(withJSONObject: message) else { return }
            source.send(line)
        }
    }

    private func resolve(_ id: Int, with result: Result<Data, Error>) {
        guard let continuation = pending.removeValue(forKey: id) else { return }
        continuation.resume(with: result)
    }

    private func failPending(_ error: HarnessCallError) {
        let waiting = pending
        pending = [:]
        for continuation in waiting.values {
            continuation.resume(throwing: error)
        }
    }
}

/// JSON-RPC error codes on the local socket (protocol/src/rpc.ts).
enum RpcErrorCode {
    static let methodNotFound = -32601
    static let invalidParams = -32602
    /// The method ran and failed. The error's data is a `UserError`.
    static let failed = -32000
}

private struct RpcRequest<Params: Encodable>: Encodable {
    let jsonrpc = "2.0"
    let id: Int
    let method: String
    let params: Params
}


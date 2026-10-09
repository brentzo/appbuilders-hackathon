import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// Runs `HarnessClient` against the real mock harness from protocol/mocks, so the tests see the
/// same messages and error shapes the app does. Needs node and `npm install` in protocol/: without
/// them these tests fail with a message saying so, rather than being skipped quietly.
@MainActor
@Suite(.serialized, .timeLimit(.minutes(2)))
struct HarnessClientTests {
    /// Generous enough that a busy machine (the model, other builds) never decides the outcome;
    /// the suite's time limit is what catches a real hang.
    static let patient = HarnessClient.Timing(callTimeout: .seconds(60), pingInterval: .seconds(5), pingTimeout: .seconds(60))

    @Test func helloPingAndEvents() async throws {
        let mock = try await MockHarnessProcess.start(script: "windows-and-bridge", speed: "0")
        defer { mock.stop() }
        let client = HarnessClient(socketPath: mock.socketPath, timing: Self.patient)
        client.start()
        defer { client.stop() }

        try await wait(for: client, toBe: .connected, answeredBy: mock)
        try await client.ping()

        // The script has 8 events. If fewer arrive, stopping the client ends the stream, so the
        // test fails on the counts below instead of waiting forever. The wait only guards a hang.
        let deadline = Task { @MainActor in
            try await Task.sleep(for: .seconds(90))
            client.stop()
        }
        defer { deadline.cancel() }
        var names: [String] = []
        var errors: [ErrorKind] = []
        for await event in client.events {
            names.append(event.name)
            if case .userError(let error) = event { errors.append(error.kind) }
            if names.count == 8 { break }
        }
        #expect(names.count == 8, "Only \(names.count) of the script's 8 events arrived in 90 seconds")
        #expect(names.contains("bridgeStateChanged"))
        #expect(names.contains("interruptedTaskFound"))
        #expect(errors.count == 2)
    }

    @Test func failedMethodCarriesAUserError() async throws {
        let mock = try await MockHarnessProcess.start(fail: "submitGoal=bridgeDown")
        defer { mock.stop() }
        let client = HarnessClient(socketPath: mock.socketPath, timing: Self.patient)
        client.start()
        defer { client.stop() }
        try await wait(for: client, toBe: .connected, answeredBy: mock)

        do {
            _ = try await client.submitGoal(SubmitGoalParams(transcript: "test", originDeviceId: "mac-local"))
            Issue.record("submitGoal should have failed")
        } catch HarnessCallError.failed(let error) {
            #expect(error.kind == .bridgeDown)
            // The mock's JSON-RPC message ("Mock failure for submitGoal") stays out of what the user sees.
            let presented = ErrorPresenter.present(error)
            #expect(presented.message == UserErrorCopy.copy(for: .bridgeDown).message)
            #expect(!presented.message.contains("Mock failure"))
            #expect(!presented.buttons.contains { $0.label.contains("Mock") || $0.label.contains("32000") })
        }
    }

    /// The mock checks params against the protocol, so a goal with Auto mode is a valid `submitGoal` (OBJ-50).
    @Test func submitsAGoalWithAutoMode() async throws {
        let mock = try await MockHarnessProcess.start()
        defer { mock.stop() }
        let client = HarnessClient(socketPath: mock.socketPath, timing: Self.patient)
        client.start()
        defer { client.stop() }
        try await wait(for: client, toBe: .connected, answeredBy: mock)

        let result = try await client.submitGoal(HarnessLink.submitGoalParams("rename the invoices", autoMode: true))
        #expect(!result.taskId.isEmpty)
    }

    /// The mock checks params against the protocol, so this is a valid `setDebugMode` (OBJ-53).
    @Test func sendsDebugMode() async throws {
        let mock = try await MockHarnessProcess.start()
        defer { mock.stop() }
        let client = HarnessClient(socketPath: mock.socketPath)
        client.start()
        defer { client.stop() }
        try await wait(for: client, toBe: .connected)

        _ = try await client.call(.setDebugMode, SetDebugModeParams(enabled: false), returning: Empty.self)
        _ = try await client.call(.setDebugMode, SetDebugModeParams(enabled: true), returning: Empty.self)
    }

    @Test func reconnectsAfterTheHarnessIsKilled() async throws {
        var mock = try await MockHarnessProcess.start()
        // Reads `mock` when the test ends, so it stops whichever mock is running then, even if the
        // test fails before the restart.
        defer { mock.stop() }
        let client = HarnessClient(socketPath: mock.socketPath, timing: Self.patient)
        client.start()
        defer { client.stop() }
        try await wait(for: client, toBe: .connected, answeredBy: mock)

        mock.kill()
        try await wait(for: client, toBe: .connecting)
        mock = try await MockHarnessProcess.start(socketPath: mock.socketPath)
        try await wait(for: client, toBe: .connected, answeredBy: mock)
        try await client.ping()
    }

    /// Waits until the link is `expected`, with no deadline of its own: the suite's time limit
    /// catches a hang. It fails at once when waiting cannot help: the versions differ, or the mock
    /// that should answer has exited.
    private func wait(
        for client: HarnessClient,
        toBe expected: HarnessClient.LinkState,
        answeredBy mock: MockHarnessProcess? = nil
    ) async throws {
        while client.linkState != expected {
            if client.linkState == .incompatible {
                Issue.record("The mock harness and PROTOCOL_VERSION (\(PROTOCOL_VERSION)) disagree")
                throw CancellationError()
            }
            if let mock, !mock.process.isRunning {
                Issue.record("The mock harness exited before the link became \(expected)")
                throw CancellationError()
            }
            try await Task.sleep(for: .milliseconds(50))
        }
    }
}

/// The mock harness as a child process of the test, on its own socket.
nonisolated struct MockHarnessProcess {
    let process: Process
    let socketPath: String

    /// Finds node like the app, but a slow login shell on a busy machine is waited for.
    static let nodeLocator = NodeLocator(timeout: .seconds(60))

    static var protocolFolder: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("protocol")
    }

    enum SetupError: Error, CustomStringConvertible {
        case dependenciesMissing(String)
        case nodeNotFound

        var description: String {
            switch self {
            case .dependenciesMissing(let path):
                "The mock harness tests need the protocol package: run `npm install` in \(path)"
            case .nodeNotFound:
                "The mock harness tests need Node.js, and node was not found through the login or interactive shell"
            }
        }
    }

    @MainActor static func start(
        script: String? = nil,
        speed: String? = nil,
        fail: String? = nil,
        socketPath: String = NSTemporaryDirectory() + "yumi-\(UUID().uuidString.prefix(8)).sock"
    ) async throws -> MockHarnessProcess {
        guard FileManager.default.fileExists(atPath: protocolFolder.appendingPathComponent("node_modules/tsx").path) else {
            throw SetupError.dependenciesMissing(protocolFolder.path)
        }
        guard let node = await nodeLocator.nodeURL() else {
            throw SetupError.nodeNotFound
        }
        let process = Process()
        process.executableURL = node
        process.currentDirectoryURL = protocolFolder
        var arguments = ["--import", "tsx", "mocks/mock-harness.ts", "--socket", socketPath]
        if let script { arguments += ["--script", script] }
        if let speed { arguments += ["--speed", speed] }
        if let fail { arguments += ["--fail", fail] }
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        return MockHarnessProcess(process: process, socketPath: socketPath)
    }

    func kill() {
        Darwin.kill(process.processIdentifier, SIGKILL)
        process.waitUntilExit()
    }

    func stop() {
        if process.isRunning {
            process.terminate()
            process.waitUntilExit()
        }
        try? FileManager.default.removeItem(atPath: socketPath)
    }
}

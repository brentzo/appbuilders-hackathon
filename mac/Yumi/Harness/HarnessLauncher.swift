import Foundation
import OSLog

/// Builds the harness process. The supervisor starts it, watches it, and restarts it.
///
/// Today the only launcher is `MockHarnessLauncher`. OBJ-14.8 adds the real harness (OBJ-03)
/// behind this same protocol.
protocol HarnessLauncher: Sendable {
    /// Shown in logs and the menu, so nobody demos the mock by accident.
    var displayName: String { get }
    var isMock: Bool { get }
    /// Returns a configured, not yet started process, or throws `HarnessLaunchError`.
    func makeProcess() async throws -> Process
}

enum HarnessLaunchError: Error, CustomStringConvertible {
    case nodeNotFound
    case dependenciesMissing(URL)
    case protocolFolderMissing(URL)

    var description: String {
        switch self {
        case .nodeNotFound: "node was not found on the login shell's PATH"
        case .dependenciesMissing(let url): "\(url.path) has no node_modules; run npm install there"
        case .protocolFolderMissing(let url): "\(url.path) does not exist; set YUMI_REPO_ROOT"
        }
    }
}

/// STAND-IN: runs the mock harness from `protocol/mocks` (OBJ-01) until the real harness exists
/// (OBJ-03, swapped in by OBJ-14.8). It needs the repo on disk with `npm install` run in `protocol/`.
///
/// It runs `node --import tsx mocks/mock-harness.ts` directly, not through npm, so the harness is
/// one process the supervisor can stop and watch.
struct MockHarnessLauncher: HarnessLauncher {
    let displayName = "mock harness"
    let isMock = true
    /// The script from `protocol/mocks/scripts` to play.
    let script: String
    /// `method=kind,...`, passed to the mock's `--fail` option.
    let failures: String?
    let socketPath: String

    /// The repo this app was built from, or `YUMI_REPO_ROOT` when set.
    static var repoRoot: URL {
        if let override = ProcessInfo.processInfo.environment["YUMI_REPO_ROOT"] {
            return URL(fileURLWithPath: override)
        }
        return URL(fileURLWithPath: #filePath) // mac/Yumi/Harness/HarnessLauncher.swift
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    func makeProcess() async throws -> Process {
        let protocolFolder = Self.repoRoot.appendingPathComponent("protocol")
        guard FileManager.default.fileExists(atPath: protocolFolder.path) else {
            throw HarnessLaunchError.protocolFolderMissing(protocolFolder)
        }
        guard FileManager.default.fileExists(atPath: protocolFolder.appendingPathComponent("node_modules/tsx").path) else {
            throw HarnessLaunchError.dependenciesMissing(protocolFolder)
        }
        guard let node = await NodeLocator.shared.nodeURL() else {
            throw HarnessLaunchError.nodeNotFound
        }
        let process = Process()
        process.executableURL = node
        process.currentDirectoryURL = protocolFolder
        var arguments = ["--import", "tsx", "mocks/mock-harness.ts", "--socket", socketPath, "--script", script]
        if let failures, !failures.isEmpty {
            arguments += ["--fail", failures]
        }
        process.arguments = arguments
        return process
    }
}

/// Finds node the way the user's Terminal would. Apps opened from Finder do not get the login
/// shell's PATH, and version managers put node in places no fixed list covers.
///
/// It asks the login shell first, then an interactive login shell, which also reads `.zshrc` or
/// `.bashrc`, where nvm is usually set up. Each try has a time limit, because a shell profile can
/// wait for input or hang.
actor NodeLocator {
    static let shared = NodeLocator()
    private let shell: String
    private let timeout: Duration
    private var cached: URL?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "harness")

    /// Printed before the path, so prompts and other profile output cannot be mistaken for it.
    private static let marker = "YUMI_NODE_PATH="

    /// `shell` defaults to the user's `SHELL`.
    init(shell: String? = nil, timeout: Duration = .seconds(5)) {
        self.shell = shell ?? ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        self.timeout = timeout
    }

    func nodeURL() async -> URL? {
        if let cached, FileManager.default.isExecutableFile(atPath: cached.path) { return cached }
        // execPath is the real binary, not a version manager's shim that would spawn a child.
        let command = "node -p '\"\(Self.marker)\" + process.execPath'"
        let attempts: [(name: String, arguments: [String])] = [
            ("login shell", ["-l", "-c", command]),
            ("interactive login shell", ["-i", "-l", "-c", command]),
        ]
        for attempt in attempts {
            switch await ShellCommand.run(shell, attempt.arguments, timeout: timeout) {
            case .timedOut:
                log.error("Finding node through the \(attempt.name, privacy: .public) (\(self.shell, privacy: .public)) took longer than \(self.timeout, privacy: .public); stopped it")
            case .failedToStart(let reason):
                log.error("Could not run \(self.shell, privacy: .public) to find node: \(reason, privacy: .public)")
            case .finished(let output):
                let path = output.split(separator: "\n")
                    .last { $0.hasPrefix(Self.marker) }
                    .map { String($0.dropFirst(Self.marker.count)).trimmingCharacters(in: .whitespacesAndNewlines) }
                if let path, FileManager.default.isExecutableFile(atPath: path) {
                    log.info("Found node at \(path, privacy: .public) through the \(attempt.name, privacy: .public)")
                    cached = URL(fileURLWithPath: path)
                    return cached
                }
            }
        }
        log.error("""
            node was not found, so the mock harness cannot start. Tried \(self.shell, privacy: .public) as a login shell \
            and as an interactive login shell. Install Node.js, or make `node` available in your shell profile, \
            then quit and reopen Yumi.
            """)
        return nil
    }
}

/// Runs a command with a time limit and returns its standard output.
nonisolated enum ShellCommand {
    enum Outcome: Sendable {
        case finished(String)
        case timedOut
        case failedToStart(String)
    }

    static func run(_ executable: String, _ arguments: [String], timeout: Duration) async -> Outcome {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        let output = Pipe()
        process.standardOutput = output
        // Collected as it arrives: a background job started by a profile could keep the pipe open
        // after the shell exits, so waiting for end of file could hang.
        let collected = OutputBuffer()
        output.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil } else { collected.append(data) }
        }
        let exited = ExitSignal()
        process.terminationHandler = { _ in exited.fire() }
        do {
            try process.run()
        } catch {
            output.fileHandleForReading.readabilityHandler = nil
            return .failedToStart(error.localizedDescription)
        }
        let finished = await exited.wait(timeout: timeout)
        if !finished {
            process.terminate()
            try? await Task.sleep(for: .milliseconds(300))
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        }
        // Let the last chunk of output arrive.
        try? await Task.sleep(for: .milliseconds(50))
        output.fileHandleForReading.readabilityHandler = nil
        return finished ? .finished(collected.text) : .timedOut
    }

    private final class OutputBuffer: @unchecked Sendable {
        private let lock = NSLock()
        private var data = Data()
        func append(_ chunk: Data) { lock.withLock { data.append(chunk) } }
        var text: String { lock.withLock { String(decoding: data, as: UTF8.self) } }
    }

    /// Fires once when the process exits; `wait` returns false if the time runs out first.
    private final class ExitSignal: @unchecked Sendable {
        private let lock = NSLock()
        private var fired = false
        private var waiter: CheckedContinuation<Bool, Never>?

        func fire() {
            let waiting: CheckedContinuation<Bool, Never>? = lock.withLock {
                fired = true
                defer { waiter = nil }
                return waiter
            }
            waiting?.resume(returning: true)
        }

        func wait(timeout: Duration) async -> Bool {
            await withCheckedContinuation { continuation in
                let alreadyFired: Bool = lock.withLock {
                    if fired { return true }
                    waiter = continuation
                    return false
                }
                if alreadyFired {
                    continuation.resume(returning: true)
                    return
                }
                Task {
                    try? await Task.sleep(for: timeout)
                    let waiting: CheckedContinuation<Bool, Never>? = self.lock.withLock {
                        defer { self.waiter = nil }
                        return self.waiter
                    }
                    waiting?.resume(returning: false)
                }
            }
        }
    }
}

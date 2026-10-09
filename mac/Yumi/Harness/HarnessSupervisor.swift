import Foundation
import OSLog

/// Starts the harness process, restarts it when it exits, and stops it when Yumi quits.
@MainActor
final class HarnessSupervisor {
    enum State: Equatable {
        case stopped
        case starting
        case running(pid: Int32)
        /// Waiting before the next start, after an exit or a failed start.
        case waitingToRestart
    }

    let launcher: HarnessLauncher
    private(set) var state: State = .stopped {
        didSet { if state != oldValue { onStateChange?(state) } }
    }
    var onStateChange: ((State) -> Void)?

    private var process: Process?
    private var stopping = false
    private var startedAt: Date?
    private var failuresInARow = 0
    private var restartTask: Task<Void, Never>?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "harness")

    /// Waits between restarts, growing after each quick failure. A run longer than
    /// `healthyRun` resets it.
    static let restartDelays: [Duration] = [.milliseconds(500), .seconds(1), .seconds(2), .seconds(4), .seconds(8)]
    static let healthyRun: TimeInterval = 30

    private var pidFile: URL {
        URL(fileURLWithPath: HarnessSocket.defaultPath).deletingLastPathComponent()
            .appendingPathComponent(launcher.isMock ? "mock-harness.pid" : "harness.pid")
    }

    init(launcher: HarnessLauncher) {
        self.launcher = launcher
    }

    func start() {
        stopping = false
        guard process == nil, restartTask == nil else { return }
        if launcher.isMock {
            log.notice("Using the MOCK harness, a stand-in until the real harness exists (OBJ-03)")
        }
        stopLeftoverProcess()
        launch()
    }

    /// Stops the harness and does not restart it. Waits briefly so it can clean up its socket.
    func stop() {
        stopping = true
        restartTask?.cancel()
        restartTask = nil
        guard let process, process.isRunning else { return }
        process.terminate()
        let deadline = Date().addingTimeInterval(1)
        while process.isRunning, Date() < deadline {
            usleep(20_000)
        }
        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
        }
        try? FileManager.default.removeItem(at: pidFile)
        state = .stopped
    }

    private func launch() {
        state = .starting
        Task {
            do {
                let process = try await launcher.makeProcess()
                guard !stopping else { return }
                pipeOutput(of: process)
                process.terminationHandler = { [weak self] finished in
                    let status = finished.terminationStatus
                    let reason = finished.terminationReason
                    Task { @MainActor in self?.processExited(status: status, reason: reason) }
                }
                try process.run()
                self.process = process
                startedAt = Date()
                try? FileManager.default.createDirectory(at: pidFile.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? String(process.processIdentifier).write(to: pidFile, atomically: true, encoding: .utf8)
                log.notice("Started the \(self.launcher.displayName, privacy: .public), pid \(process.processIdentifier)")
                state = .running(pid: process.processIdentifier)
            } catch {
                log.error("Could not start the \(self.launcher.displayName, privacy: .public): \(String(describing: error), privacy: .public)")
                scheduleRestart()
            }
        }
    }

    private func processExited(status: Int32, reason: Process.TerminationReason) {
        process = nil
        try? FileManager.default.removeItem(at: pidFile)
        guard !stopping else { return }
        let how = reason == .uncaughtSignal ? "was killed by signal \(status)" : "exited with status \(status)"
        log.error("The \(self.launcher.displayName, privacy: .public) \(how, privacy: .public); restarting it")
        if let startedAt, Date().timeIntervalSince(startedAt) > Self.healthyRun {
            failuresInARow = 0
        }
        scheduleRestart()
    }

    private func scheduleRestart() {
        state = .waitingToRestart
        let delay = Self.restartDelays[min(failuresInARow, Self.restartDelays.count - 1)]
        failuresInARow += 1
        restartTask = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            restartTask = nil
            if !stopping { launch() }
        }
    }

    /// Sends the harness's output to Yumi's log, one entry per line, so the team can read it in
    /// Console. The mock prefixes each line with "[mock harness]".
    private func pipeOutput(of process: Process) {
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        let log = Logger(subsystem: "ph.appbuilders.yumi", category: "harness-output")
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
                log.notice("\(line, privacy: .public)")
            }
        }
    }

    /// A harness left running by a Yumi that crashed would keep the socket busy. Stop it, but only
    /// if that pid is still the same kind of harness.
    private func stopLeftoverProcess() {
        guard let text = try? String(contentsOf: pidFile, encoding: .utf8),
              let pid = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return }
        try? FileManager.default.removeItem(at: pidFile)
        let marker = launcher.isMock ? "mock-harness" : "harness"
        guard Self.commandLine(of: pid)?.contains(marker) == true else { return }
        log.notice("Stopping a leftover \(self.launcher.displayName, privacy: .public), pid \(pid)")
        kill(pid, SIGTERM)
    }

    private static func commandLine(of pid: Int32) -> String? {
        let ps = Process()
        ps.executableURL = URL(fileURLWithPath: "/bin/ps")
        ps.arguments = ["-p", String(pid), "-o", "command="]
        let output = Pipe()
        ps.standardOutput = output
        ps.standardError = FileHandle.nullDevice
        guard (try? ps.run()) != nil else { return nil }
        ps.waitUntilExit()
        let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        return ps.terminationStatus == 0 ? text : nil
    }
}

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
        return URL(fileURLWithPath: #filePath) // mac/Yumi/Harness/MockHarnessLauncher.swift
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
actor NodeLocator {
    static let shared = NodeLocator()
    private var cached: URL?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "harness")

    func nodeURL() async -> URL? {
        if let cached, FileManager.default.isExecutableFile(atPath: cached.path) { return cached }
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        // execPath is the real binary, not a version manager's shim that would spawn a child.
        process.arguments = ["-l", "-c", "node -p process.execPath"]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            log.error("Could not run \(shell, privacy: .public) to find node: \(error.localizedDescription, privacy: .public)")
            return nil
        }
        let data = await Task.detached { output.fileHandleForReading.readDataToEndOfFile() }.value
        process.waitUntilExit()
        let path = String(decoding: data, as: UTF8.self)
            .split(separator: "\n").last.map(String.init)?
            .trimmingCharacters(in: .whitespaces) ?? ""
        guard process.terminationStatus == 0, FileManager.default.isExecutableFile(atPath: path) else {
            log.error("node was not found from \(shell, privacy: .public) -l")
            return nil
        }
        cached = URL(fileURLWithPath: path)
        return cached
    }
}

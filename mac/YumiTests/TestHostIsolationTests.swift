import AppKit
import Foundation
import Testing
@testable import Yumi

/// The test host never reaches a Yumi the user is running at the same time: it starts no harness,
/// stops no harness, and its socket, pid file, task store, and log are in a temporary folder, not
/// in `~/Library/Application Support/Yumi`.
@MainActor
struct TestHostIsolationTests {
    /// Only touched on the main actor, by the supervisor and the test.
    final class RecordingLauncher: HarnessLauncher, @unchecked Sendable {
        let displayName = "harness"
        let isMock = false
        var made = 0
        func makeProcess() async throws -> Process {
            made += 1
            throw CancellationError()
        }
    }

    static let realFolder = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Yumi", isDirectory: true)

    @Test func thisProcessKnowsItIsATestHost() {
        #expect(TestHost.isActive)
        #expect(TestHost.isActive(in: ["XCTestSessionIdentifier": "x"]))
        #expect(!TestHost.isActive(in: ["HOME": "/Users/someone"]))
    }

    /// A quit sent to Yumi by its bundle id, such as relaunching the live app, also reaches the test
    /// host. It ended a verify run at 6:33 am on 2026-10-10 in the middle of
    /// `PhraseSpotterTests.heyYumiThenAGoalReachesTheHarness`, so the test host refuses it.
    @Test func theTestHostRefusesToQuitOnRequestAndTheAppDoesNot() {
        #expect(AppDelegate.terminateReply(isHostingTests: true) == .terminateCancel)
        #expect(AppDelegate.terminateReply(isHostingTests: false) == .terminateNow)
    }

    @Test func theHarnessFolderAndSocketAreTemporaryHere() {
        let folder = HarnessFolder.url.standardizedFileURL.path
        #expect(!folder.hasPrefix(Self.realFolder.standardizedFileURL.path))
        #expect(folder.hasPrefix(FileManager.default.temporaryDirectory.standardizedFileURL.path))
        #expect(HarnessSocket.defaultPath == HarnessFolder.url.appendingPathComponent("harness.sock").path)
        #expect(HarnessClient().socketPath == HarnessSocket.defaultPath)
    }

    @Test func theFolderIsTheOverrideThenTemporaryForTestsThenApplicationSupport() {
        let override = HarnessFolder.resolve(environment: ["YUMI_SUPPORT_DIR": "/tmp/yumi-elsewhere"], isTestHost: true)
        #expect(override.path == "/tmp/yumi-elsewhere")
        let tests = HarnessFolder.resolve(environment: [:], isTestHost: true)
        #expect(tests.path.hasPrefix(FileManager.default.temporaryDirectory.path))
        let app = HarnessFolder.resolve(environment: [:], isTestHost: false)
        #expect(app.standardizedFileURL.path == Self.realFolder.standardizedFileURL.path)
    }

    @Test func theHarnessIsToldTheSameFolder() {
        let folder = URL(fileURLWithPath: "/tmp/yumi-folder", isDirectory: true)
        let environment = RealHarnessLauncher.environment(["PATH": "/usr/bin", "YUMI_SUPPORT_DIR": "/elsewhere"], folder: folder)
        #expect(environment["YUMI_SUPPORT_DIR"] == "/tmp/yumi-folder")
        #expect(environment["PATH"] == "/usr/bin")
        #expect(RealHarnessLauncher.environment([:])["YUMI_SUPPORT_DIR"] == HarnessFolder.url.path)
    }

    /// The collision this guards against: starting a supervisor stops the harness named in the pid
    /// file, and a harness started by tests would take the user's socket.
    @Test func aSupervisorInATestHostStartsNothingAndStopsNothing() async throws {
        // A stand-in for a running harness, with "harness" in its command line like the real one.
        let running = Process()
        running.executableURL = URL(fileURLWithPath: "/bin/sh")
        running.arguments = ["-c", "sleep 30; :", "harness"]
        try running.run()
        defer { running.terminate() }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("yumi-pid-\(UUID().uuidString.prefix(8))")
        let pidFile = folder.appendingPathComponent("harness.pid")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try String(running.processIdentifier).write(to: pidFile, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: folder) }

        let launcher = RecordingLauncher()
        // The default for the test host, as the app delegate would build it.
        let supervisor = HarnessSupervisor(launcher: launcher, folder: folder)
        supervisor.start()
        try await Task.sleep(for: .milliseconds(300))

        #expect(launcher.made == 0)
        #expect(supervisor.state == .stopped)
        #expect(running.isRunning)
        #expect(FileManager.default.fileExists(atPath: pidFile.path))
    }
}

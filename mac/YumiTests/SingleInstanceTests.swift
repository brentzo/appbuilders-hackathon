import AppKit
import Foundation
import Testing
@testable import Yumi

/// Two launches never take each other's harness: a later Yumi gives way to the one already
/// running, and a harness in the pid file is stopped only when the Yumi that started it is gone.
@MainActor
@Suite(.serialized)
struct SingleInstanceTests {
    typealias Instance = SingleInstance.Instance

    @Test func aLaterLaunchGivesWayToTheYumiAlreadyRunning() {
        let first = Instance(pid: 900, launched: Date(timeIntervalSince1970: 100))
        let me = Instance(pid: 500, launched: Date(timeIntervalSince1970: 200))
        #expect(SingleInstance.firstRunning(before: me, among: [me, first]) == first)
        // The first Yumi stays when the second one is seen.
        #expect(SingleInstance.firstRunning(before: first, among: [first, me]) == nil)
        #expect(SingleInstance.firstRunning(before: me, among: [me]) == nil)
    }

    @Test func launchesAtTheSameMomentKeepExactlyOne() {
        let now = Date()
        let low = Instance(pid: 10, launched: now)
        let high = Instance(pid: 20, launched: now)
        #expect(SingleInstance.firstRunning(before: low, among: [low, high]) == nil)
        #expect(SingleInstance.firstRunning(before: high, among: [low, high]) == low)
        // No launch date counts as earliest, then by pid.
        let unknown = Instance(pid: 30, launched: nil)
        #expect(SingleInstance.firstRunning(before: low, among: [low, unknown]) == unknown)
    }

    @Test func thisProcessIsNotAnotherRunningYumi() {
        // The test host is Yumi itself, so it is a running Yumi; a pid that cannot exist is not.
        #expect(SingleInstance.isRunningYumi(ProcessInfo.processInfo.processIdentifier))
        #expect(!SingleInstance.isRunningYumi(Int32.max))
    }

    @Test func thePidFileNamesTheHarnessAndItsYumi() {
        let record = HarnessPidRecord(harness: 4242, app: 77)
        #expect(HarnessPidRecord(text: record.text) == record)
        #expect(HarnessPidRecord(text: "4242\n") == HarnessPidRecord(harness: 4242, app: nil))
        #expect(HarnessPidRecord(text: "not a pid") == nil)
        #expect(record.isLeftover(appIsRunning: { _ in false }))
        #expect(!record.isLeftover(appIsRunning: { $0 == 77 }))
        // A file from before Yumi recorded itself: the harness counts as left over, as before.
        #expect(HarnessPidRecord(harness: 4242, app: nil).isLeftover(appIsRunning: { _ in true }))
    }

    /// Only touched on the main actor, by the supervisor and the test.
    final class NoLaunch: HarnessLauncher, @unchecked Sendable {
        let displayName = "harness"
        let isMock = false
        func makeProcess() async throws -> Process { throw CancellationError() }
    }

    /// Runs a stand-in harness named in a pid file in its own temporary folder,
    /// starts a supervisor that is allowed to start, and reports whether the stand-in was stopped.
    private func standInSurvives(ownerRunning: Bool) async throws -> Bool {
        let running = Process()
        running.executableURL = URL(fileURLWithPath: "/bin/sh")
        running.arguments = ["-c", "sleep 30; :", "harness"]
        try running.run()
        defer { if running.isRunning { running.terminate() } }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("yumi-pid-\(UUID().uuidString.prefix(8))")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let pidFile = folder.appendingPathComponent("harness.pid")
        try HarnessPidRecord(harness: running.processIdentifier, app: 77).text.write(to: pidFile, atomically: true, encoding: .utf8)

        let supervisor = HarnessSupervisor(launcher: NoLaunch(), isTestHost: false, appIsRunning: { $0 == 77 && ownerRunning }, folder: folder)
        supervisor.start()
        supervisor.stop()
        if ownerRunning { return running.isRunning }
        // The SIGTERM was sent before `start` returned; wait for the stand-in to go.
        while running.isRunning { try await Task.sleep(for: .milliseconds(20)) }
        return false
    }

    @Test(.timeLimit(.minutes(1)))
    func aSecondYumiLeavesTheRunningYumisHarnessAlone() async throws {
        #expect(try await standInSurvives(ownerRunning: true))
    }

    @Test(.timeLimit(.minutes(1)))
    func aCrashedYumisHarnessIsStillStopped() async throws {
        #expect(try await !standInSurvives(ownerRunning: false))
    }
}

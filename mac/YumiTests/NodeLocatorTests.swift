import Foundation
import Testing
@testable import Yumi

struct NodeLocatorTests {
    /// Writes an executable fake shell and returns its path.
    private func fakeShell(_ body: String) throws -> String {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("yumi-shell-\(UUID().uuidString.prefix(8)).sh")
        try ("#!/bin/sh\n" + body).write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url.path
    }

    @Test func fallsBackToTheInteractiveShellLikeNvm() async throws {
        // Like nvm: node is only on PATH once .zshrc runs, so only the interactive shell finds it.
        let shell = try fakeShell("""
            if [ "$1" = "-i" ]; then echo "profile noise"; echo "YUMI_NODE_PATH=/bin/sh"; else echo "node: command not found" >&2; exit 127; fi
            """)
        defer { try? FileManager.default.removeItem(atPath: shell) }
        let node = await NodeLocator(shell: shell, timeout: .seconds(5)).nodeURL()
        #expect(node?.path == "/bin/sh")
    }

    @Test(.timeLimit(.minutes(2)))
    func aHangingShellTimesOut() async throws {
        // The shell hangs for 90 s. Coming back in under 30 s can only be the timeout, however slow
        // a busy machine is to start the shell; without the timeout the test runs into its limit.
        let shell = try fakeShell("sleep 90\n")
        defer { try? FileManager.default.removeItem(atPath: shell) }
        let start = ContinuousClock.now
        let node = await NodeLocator(shell: shell, timeout: .milliseconds(500)).nodeURL()
        #expect(node == nil)
        #expect(ContinuousClock.now - start < .seconds(30))
    }

    @Test(.timeLimit(.minutes(1)))
    func aTimeoutStopsEverythingTheShellStarted() async throws {
        // The shell starts two children and waits. It writes every pid to a file, so the test can
        // check exactly those processes instead of searching the process list by name.
        let pidFile = FileManager.default.temporaryDirectory.appendingPathComponent("yumi-pids-\(UUID().uuidString.prefix(8))")
        let shell = try fakeShell("""
            echo $$ >> '\(pidFile.path)'
            sleep 30 & echo $! >> '\(pidFile.path)'
            sleep 30 & echo $! >> '\(pidFile.path)'
            wait

            """)
        defer {
            try? FileManager.default.removeItem(atPath: shell)
            try? FileManager.default.removeItem(at: pidFile)
        }
        // Long enough for a brand-new script to start and record its children on a busy machine,
        // and still far below the children's 30 s, so only the timeout can stop them.
        let outcome = await ShellCommand.run(shell, ["-l", "-c", "true"], timeout: .seconds(10))
        guard case .timedOut = outcome else {
            Issue.record("Expected a timeout, got \(outcome)")
            return
        }
        let pids = try String(contentsOf: pidFile, encoding: .utf8).split(separator: "\n").compactMap { Int32($0) }
        #expect(pids.count == 3)
        // The children exit asynchronously after the kill; a busy machine can take a while.
        // kill with signal 0 only checks whether the process exists.
        func alive(_ pid: Int32) -> Bool { !(kill(pid, 0) == -1 && errno == ESRCH) }
        let deadline = ContinuousClock.now + .seconds(10)
        while pids.contains(where: alive), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        for pid in pids {
            #expect(!alive(pid), "pid \(pid) survived the timeout")
        }
    }

    @Test func readsOnlyTheMarkedLine() async throws {
        let shell = try fakeShell("echo 'YUMI_NODE_PATH=/not/a/file'; echo '/bin/sh'\n")
        defer { try? FileManager.default.removeItem(atPath: shell) }
        #expect(await NodeLocator(shell: shell, timeout: .seconds(5)).nodeURL() == nil)
    }
}

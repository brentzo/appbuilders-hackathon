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

    @Test(.timeLimit(.minutes(1)))
    func aHangingShellTimesOut() async throws {
        let shell = try fakeShell("sleep 30\n")
        defer { try? FileManager.default.removeItem(atPath: shell) }
        let start = ContinuousClock.now
        let node = await NodeLocator(shell: shell, timeout: .milliseconds(500)).nodeURL()
        #expect(node == nil)
        #expect(ContinuousClock.now - start < .seconds(5))
    }

    @Test func readsOnlyTheMarkedLine() async throws {
        let shell = try fakeShell("echo 'YUMI_NODE_PATH=/not/a/file'; echo '/bin/sh'\n")
        defer { try? FileManager.default.removeItem(atPath: shell) }
        #expect(await NodeLocator(shell: shell, timeout: .seconds(5)).nodeURL() == nil)
    }
}

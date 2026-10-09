import Darwin
import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// `hello` carries the generated PROTOCOL_VERSION, whatever it is, and a harness that answers
/// with another version is refused. Uses a fake harness in the test, so it pins no number and does
/// not depend on the mock's own version check.
@MainActor
@Suite(.serialized, .timeLimit(.minutes(1)))
struct HelloVersionTests {
    @Test func helloSendsTheGeneratedVersion() async throws {
        let harness = try FakeHarness(answerVersion: PROTOCOL_VERSION)
        defer { harness.stop() }
        let client = HarnessClient(socketPath: harness.path)
        client.start()
        defer { client.stop() }

        try await waitUntil { client.linkState == .connected }
        #expect(harness.helloVersions == [PROTOCOL_VERSION])
    }

    @Test func aDifferentHarnessVersionIsRefused() async throws {
        let harness = try FakeHarness(answerVersion: PROTOCOL_VERSION + 1)
        defer { harness.stop() }
        let client = HarnessClient(socketPath: harness.path)
        client.start()
        defer { client.stop() }

        try await waitUntil { client.linkState == .incompatible }
        #expect(harness.helloVersions == [PROTOCOL_VERSION])
    }

    private func waitUntil(_ condition: () -> Bool) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now + .seconds(10)
        while !condition() {
            guard clock.now < deadline else {
                Issue.record("Timed out waiting")
                throw CancellationError()
            }
            try await Task.sleep(for: .milliseconds(20))
        }
    }
}

/// A fake harness on a Unix socket: answers `hello` with `answerVersion` and `ping` with `{}`,
/// and records the version each `hello` sent.
nonisolated final class FakeHarness: @unchecked Sendable {
    let path = NSTemporaryDirectory() + "yumi-fake-\(UUID().uuidString.prefix(8)).sock"
    private let listener: Int32
    private let lock = NSLock()
    private var versions: [Int] = []
    private var clients: [Int32] = []

    var helloVersions: [Int] { lock.withLock { versions } }

    init(answerVersion: Int) throws {
        listener = socket(AF_UNIX, SOCK_STREAM, 0)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8) + [0]
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0, listen(listener, 4) == 0 else { throw POSIXError(.EADDRINUSE) }
        let listeningSocket = listener
        Thread.detachNewThread { [self] in
            while true {
                let client = accept(listeningSocket, nil, nil)
                guard client >= 0 else { return }
                lock.withLock { clients.append(client) }
                Thread.detachNewThread { [self] in serve(client, answerVersion: answerVersion) }
            }
        }
    }

    private func serve(_ client: Int32, answerVersion: Int) {
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = read(client, &chunk, chunk.count)
            guard count > 0 else { return }
            buffer.append(contentsOf: chunk[0..<count])
            while let newline = buffer.firstIndex(of: 0x0A) {
                let line = buffer[buffer.startIndex..<newline]
                buffer.removeSubrange(buffer.startIndex...newline)
                guard let message = (try? JSONSerialization.jsonObject(with: Data(line))) as? [String: Any],
                      let id = message["id"] as? Int, let method = message["method"] as? String else { continue }
                var result: [String: Any] = [:]
                if method == "hello" {
                    let params = message["params"] as? [String: Any]
                    lock.withLock { versions.append(params?["protocolVersion"] as? Int ?? -1) }
                    result = ["protocolVersion": answerVersion]
                }
                let reply = try! JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "id": id, "result": result]) + Data([0x0A])
                _ = reply.withUnsafeBytes { write(client, $0.baseAddress, reply.count) }
            }
        }
    }

    func stop() {
        close(listener)
        lock.withLock { clients.forEach { close($0) } }
        unlink(path)
    }
}

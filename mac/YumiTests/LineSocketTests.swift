import Darwin
import Foundation
import Testing
@testable import Yumi

@MainActor
struct LineSocketTests {
    /// Many lines, then a close: every line arrives in order, and the close comes after the last.
    @Test(.timeLimit(.minutes(1)))
    func deliversLinesThenCloseInOrder() async throws {
        let count = 2000
        let path = NSTemporaryDirectory() + "yumi-line-\(UUID().uuidString.prefix(8)).sock"
        let server = try TestLineServer(path: path, lines: (0..<count).map { "{\"n\":\($0)}" })
        defer { server.cleanUp() }

        var received: [Int] = []
        var linesAtClose: Int?
        let socket = try LineSocket.connect(
            path: path,
            onLine: { _, data in
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Int]
                received.append(object?["n"] ?? -1)
            },
            onClose: { _ in linesAtClose = received.count }
        )
        // Nothing is delivered before reading starts, and nothing sent meanwhile is lost.
        try await Task.sleep(for: .milliseconds(300))
        #expect(received.isEmpty)
        #expect(linesAtClose == nil)
        socket.startReading()

        let clock = ContinuousClock()
        let deadline = clock.now + .seconds(20)
        while linesAtClose == nil, clock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(received == Array(0..<count))
        #expect(linesAtClose == count)
    }
}

/// A one-shot Unix socket server: accepts one client, writes the lines, and closes.
nonisolated final class TestLineServer: @unchecked Sendable {
    private let listener: Int32
    private let path: String

    init(path: String, lines: [String]) throws {
        self.path = path
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
        guard bound == 0, listen(listener, 1) == 0 else { throw POSIXError(.EADDRINUSE) }
        let payload = Array(lines.map { $0 + "\n" }.joined().utf8)
        let listeningSocket = listener
        Thread.detachNewThread {
            let client = accept(listeningSocket, nil, nil)
            guard client >= 0 else { return }
            var offset = 0
            while offset < payload.count {
                // Odd-sized writes, so lines are split across reads.
                let size = min(777, payload.count - offset)
                let written = payload[offset..<(offset + size)].withUnsafeBytes { write(client, $0.baseAddress, size) }
                guard written > 0 else { break }
                offset += written
            }
            close(client)
        }
    }

    func cleanUp() {
        close(listener)
        unlink(path)
    }
}

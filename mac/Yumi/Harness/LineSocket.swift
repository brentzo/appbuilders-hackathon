import Darwin
import Foundation

/// A connected Unix domain socket that sends and receives one message per line.
///
/// All socket work runs on a private serial queue. `onLine` and `onClose` reach the main actor
/// through `DispatchQueue.main`, one serial path, so lines arrive in the order they were read and
/// the close always comes after the last line. `onClose` is called once. Both pass the socket, so
/// the owner can ignore a socket it has already replaced.
nonisolated final class LineSocket: @unchecked Sendable {
    enum ConnectError: Error, CustomStringConvertible {
        case pathTooLong
        case socketFailed(Int32)
        case connectFailed(Int32)

        var description: String {
            switch self {
            case .pathTooLong: "socket path is too long"
            case .socketFailed(let code): "socket() failed: \(String(cString: strerror(code)))"
            case .connectFailed(let code): "connect() failed: \(String(cString: strerror(code)))"
            }
        }
    }

    private let fd: Int32
    private let queue = DispatchQueue(label: "ph.appbuilders.yumi.harness-socket")
    private var source: DispatchSourceRead?
    private var buffer = Data()
    private var closed = false
    private let onLine: @MainActor @Sendable (LineSocket, Data) -> Void
    private let onClose: @MainActor @Sendable (LineSocket) -> Void

    /// Connects, blocking the calling thread briefly. Call it off the main actor.
    ///
    /// The socket does not read until `startReading()`, so the owner can record it as its current
    /// socket first. Anything the other side sends in the meantime waits in the kernel buffer.
    static func connect(
        path: String,
        onLine: @escaping @MainActor @Sendable (LineSocket, Data) -> Void,
        onClose: @escaping @MainActor @Sendable (LineSocket) -> Void
    ) throws -> LineSocket {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw ConnectError.socketFailed(errno) }
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(path.utf8) + [0]
        guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            Darwin.close(fd)
            throw ConnectError.pathTooLong
        }
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: pathBytes) }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else {
            let code = errno
            Darwin.close(fd)
            throw ConnectError.connectFailed(code)
        }
        return LineSocket(fd: fd, onLine: onLine, onClose: onClose)
    }

    private init(
        fd: Int32,
        onLine: @escaping @MainActor @Sendable (LineSocket, Data) -> Void,
        onClose: @escaping @MainActor @Sendable (LineSocket) -> Void
    ) {
        self.fd = fd
        self.onLine = onLine
        self.onClose = onClose
    }

    /// Sends one message. A newline is added.
    func send(_ message: Data) {
        queue.async { [self] in
            guard !closed else { return }
            var bytes = message
            bytes.append(0x0A)
            let ok = bytes.withUnsafeBytes { raw -> Bool in
                var offset = 0
                while offset < raw.count {
                    let written = Darwin.write(fd, raw.baseAddress! + offset, raw.count - offset)
                    if written < 0 {
                        if errno == EINTR { continue }
                        return false
                    }
                    offset += written
                }
                return true
            }
            if !ok { closeOnQueue() }
        }
    }

    func close() {
        queue.async { [self] in closeOnQueue() }
    }

    /// Starts delivering lines (and the close). Call it once.
    func startReading() {
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [self] in readAvailable() }
        source.setCancelHandler { [fd] in Darwin.close(fd) }
        self.source = source
        source.resume()
    }

    private func readAvailable() {
        var chunk = [UInt8](repeating: 0, count: 64 * 1024)
        let count = Darwin.read(fd, &chunk, chunk.count)
        guard count > 0 else {
            if count < 0, errno == EINTR || errno == EAGAIN { return }
            closeOnQueue()
            return
        }
        buffer.append(contentsOf: chunk[0..<count])
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<newline]
            buffer.removeSubrange(buffer.startIndex...newline)
            if !line.allSatisfy({ $0 == 0x20 || $0 == 0x0D }) {
                let message = Data(line)
                DispatchQueue.main.async { [self, onLine] in
                    MainActor.assumeIsolated { onLine(self, message) }
                }
            }
        }
    }

    private func closeOnQueue() {
        guard !closed else { return }
        closed = true
        if let source {
            source.cancel() // its cancel handler closes the file descriptor
        } else {
            Darwin.close(fd) // never started reading
        }
        source = nil
        DispatchQueue.main.async { [self, onClose] in
            MainActor.assumeIsolated { onClose(self) }
        }
    }
}

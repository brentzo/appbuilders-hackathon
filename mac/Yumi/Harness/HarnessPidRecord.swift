import Foundation

/// The supervisor's pid file: the harness it started and the Yumi that started it, one per line.
///
/// When Yumi starts, a harness named in the file is stopped only if the Yumi that started it is
/// gone, so a crashed Yumi's harness does not keep the socket busy, but a second launch never stops
/// the harness of a Yumi that is still running.
struct HarnessPidRecord: Equatable {
    let harness: Int32
    /// Nil in a file written before Yumi recorded itself: then the harness counts as left over.
    let app: Int32?

    init(harness: Int32, app: Int32?) {
        self.harness = harness
        self.app = app
    }

    init?(text: String) {
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
        guard let first = lines.first, let harness = Int32(first) else { return nil }
        self.harness = harness
        app = lines.dropFirst().first.flatMap { Int32($0) }
    }

    var text: String {
        app.map { "\(harness)\n\($0)\n" } ?? "\(harness)\n"
    }

    func isLeftover(appIsRunning: (Int32) -> Bool) -> Bool {
        guard let app else { return true }
        return !appIsRunning(app)
    }
}

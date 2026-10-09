import Foundation

enum HarnessSocket {
    /// Where the harness listens on the Mac (protocol/README.md, "Local RPC").
    static var defaultPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Yumi/harness.sock").path
    }
}

import Foundation

enum HarnessSocket {
    /// Where the harness listens on the Mac (protocol/README.md, "Local RPC"): in the harness folder,
    /// which is a temporary one when hosting tests.
    static var defaultPath: String {
        HarnessFolder.url.appendingPathComponent("harness.sock").path
    }
}

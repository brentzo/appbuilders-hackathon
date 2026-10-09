import Foundation

/// True when this process is the host for Yumi's unit tests (`xcodebuild test`, Xcode, or
/// `scripts/verify.py`). Xcode sets one of these for the test host; which one depends on the Xcode
/// version and how the tests were started, so any of them counts.
enum TestHost {
    static let isActive = isActive(in: ProcessInfo.processInfo.environment)

    static func isActive(in environment: [String: String]) -> Bool {
        ["XCTestConfigurationFilePath", "XCTestBundlePath", "XCTestSessionIdentifier"].contains { environment[$0] != nil }
    }
}

/// The folder the harness runs in: its socket, its pid file, its task store, and its log. Yumi and
/// the harness must agree on it, so Yumi passes it to the harness as `YUMI_SUPPORT_DIR`.
///
/// - `YUMI_SUPPORT_DIR` from Yumi's own environment, when set.
/// - In a test host, a new temporary folder for this process, so tests never reach the harness,
///   socket, tasks, or logs of a Yumi the user is running at the same time.
/// - Otherwise `~/Library/Application Support/Yumi`, the harness's own default.
///
/// Downloaded models stay in Application Support either way: tests only read them.
enum HarnessFolder {
    static let url = resolve(environment: ProcessInfo.processInfo.environment, isTestHost: TestHost.isActive)

    static let environmentKey = "YUMI_SUPPORT_DIR"

    static func resolve(environment: [String: String], isTestHost: Bool) -> URL {
        if let override = environment[environmentKey], !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        if isTestHost {
            return FileManager.default.temporaryDirectory
                .appendingPathComponent("yumi-test-host-\(ProcessInfo.processInfo.processIdentifier)", isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Yumi", isDirectory: true)
    }
}

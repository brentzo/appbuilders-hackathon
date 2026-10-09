import Foundation

/// Options passed on the command line as `-Key value`, for example
/// `open Yumi.app --args -YumiMockScript windows-and-bridge`.
///
/// Reads only the launch-argument domain. `UserDefaults.standard.string(forKey:)` would also read
/// values saved in Yumi's preferences, so a test option written there once would act on every
/// launch after it.
enum LaunchArguments {
    static func string(_ key: String, in domain: [String: Any] = current) -> String? {
        domain[key] as? String
    }

    static func bool(_ key: String, in domain: [String: Any] = current) -> Bool {
        guard let value = string(key, in: domain)?.lowercased() else { return false }
        return ["yes", "true", "1"].contains(value)
    }

    static var current: [String: Any] {
        UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
    }
}

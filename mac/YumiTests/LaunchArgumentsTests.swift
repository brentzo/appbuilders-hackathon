import Foundation
import Testing
@testable import Yumi

struct LaunchArgumentsTests {
    @Test func readsOnlyTheArgumentDomain() {
        let domain: [String: Any] = ["YumiMockScript": "windows-and-bridge", "YumiSendSampleGoal": "YES"]
        #expect(LaunchArguments.string("YumiMockScript", in: domain) == "windows-and-bridge")
        #expect(LaunchArguments.bool("YumiSendSampleGoal", in: domain))
        #expect(LaunchArguments.bool("YumiMockFail", in: domain) == false)
    }

    @Test func ignoresValuesSavedInPreferences() throws {
        // A separate suite, so the test never writes to the app's real preferences.
        let name = "yumi.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let key = "YumiMockFail"
        defaults.set("submitGoal=bridgeDown", forKey: key)
        #expect(defaults.string(forKey: key) == "submitGoal=bridgeDown")
        #expect(LaunchArguments.string(key, in: LaunchArguments.arguments(of: defaults)) == nil)
    }
}

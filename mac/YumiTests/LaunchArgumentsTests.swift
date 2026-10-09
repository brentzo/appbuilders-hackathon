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

    @Test func ignoresValuesSavedInPreferences() {
        let key = "YumiMockFail"
        UserDefaults.standard.set("submitGoal=bridgeDown", forKey: key)
        defer { UserDefaults.standard.removeObject(forKey: key) }
        #expect(UserDefaults.standard.string(forKey: key) == "submitGoal=bridgeDown")
        #expect(LaunchArguments.string(key) == nil)
    }
}

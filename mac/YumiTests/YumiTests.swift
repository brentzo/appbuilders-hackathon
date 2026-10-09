import Foundation
import Testing
@testable import Yumi

struct YumiTests {
    @Test func appTargetLoads() {
        #expect(Bundle.main.bundleIdentifier == "ph.appbuilders.yumi")
    }
}

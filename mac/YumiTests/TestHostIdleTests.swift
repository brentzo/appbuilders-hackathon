import Testing
@testable import Yumi

/// The test host launches Yumi but never makes its live services. Making the harness link also
/// starts loading the neural voice (Kokoro on MLX); a test run that ended mid-load made MLX fail
/// at exit with "Not allowed on stopped ThreadPool".
@MainActor
struct TestHostIdleTests {
    @Test func theTestHostMakesNoHarnessLinkAndLoadsNoVoice() {
        let app = AppDelegate.current
        #expect(app != nil, "the test host runs Yumi's app delegate")
        #expect(app?.hasHarnessLink == false)
    }
}

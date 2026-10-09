import Testing
@testable import Yumi

/// Starting an app for the capability probe (OBJ-27.1). On 2026-10-10 at 3:56 am "Open Spotify"
/// failed with didNotStart: Spotify's first process exited 0.4 s after launch and a new one took
/// over, while the probe kept waiting on the first one.
@MainActor
struct AppLauncherTests {
    final class FakeApp: AppLauncher.Instance {
        var isFinishedLaunching = false
        var isTerminated = false
    }

    @Test func anAppThatRestartsItselfIsFoundInItsNewProcess() async throws {
        let first = FakeApp()
        let second = FakeApp()
        var polls = 0
        let app = try await AppLauncher.waitUntilLaunched(first, current: { second }) { _ in
            polls += 1
            if polls == 3 { first.isTerminated = true }
            if polls == 6 { second.isFinishedLaunching = true }
        }
        #expect(app === second)
    }

    @Test func anAppThatFinishesLaunchingIsReturned() async throws {
        let app = FakeApp()
        var polls = 0
        let found = try await AppLauncher.waitUntilLaunched(app, current: { nil }) { _ in
            polls += 1
            if polls == 2 { app.isFinishedLaunching = true }
        }
        #expect(found === app)
    }

    @Test func anAppThatNeverFinishesLaunchingFailsWithoutRealWaiting() async {
        let app = FakeApp()
        var polls = 0
        await #expect(throws: AppLauncher.Failure.self) {
            _ = try await AppLauncher.waitUntilLaunched(app, current: { nil }) { _ in polls += 1 }
        }
        #expect(polls == AppLauncher.launchPolls - 1)
    }
}

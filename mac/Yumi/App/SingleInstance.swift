import AppKit

/// One Yumi at a time: two would each run a harness on the same socket and watch the same
/// shortcuts. A second launch gives way to the Yumi that was running first, so two launches never take each
/// other's harness, socket, or shortcuts. Other builds of Yumi share the bundle identifier, so a
/// build from another worktree counts too.
enum SingleInstance {
    struct Instance: Equatable {
        let pid: Int32
        let launched: Date?
    }

    /// The Yumi this launch should give way to: one that started before it. Launches at the same
    /// moment are ordered by pid, so exactly one of them stays.
    static func firstRunning(before me: Instance, among others: [Instance]) -> Instance? {
        others.filter { $0.pid != me.pid && comesFirst($0, me) }.min { comesFirst($0, $1) }
    }

    static func comesFirst(_ a: Instance, _ b: Instance) -> Bool {
        let (left, right) = (a.launched ?? .distantPast, b.launched ?? .distantPast)
        return left == right ? a.pid < b.pid : left < right
    }

    /// The running Yumi this launch should give way to, if any.
    @MainActor
    static func runningYumiToDeferTo() -> NSRunningApplication? {
        let current = NSRunningApplication.current
        guard let bundleId = current.bundleIdentifier else { return nil }
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).filter { !$0.isTerminated }
        let me = Instance(pid: current.processIdentifier, launched: current.launchDate)
        let first = firstRunning(before: me, among: others.map { Instance(pid: $0.processIdentifier, launched: $0.launchDate) })
        return first.flatMap { found in others.first { $0.processIdentifier == found.pid } }
    }

    /// Whether `pid` is a Yumi that is still running.
    nonisolated static func isRunningYumi(_ pid: Int32) -> Bool {
        guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated else { return false }
        return app.bundleIdentifier != nil && app.bundleIdentifier == Bundle.main.bundleIdentifier
    }
}

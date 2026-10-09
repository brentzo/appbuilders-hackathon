/// What Yumi is doing, shown as the first line of the menu.
///
/// `startingUp` shows while the harness is not ready yet. The others come from the harness's task
/// events (OBJ-14.5); `listening` comes from voice intake (OBJ-15).
enum AppStatus: String, CaseIterable, Sendable {
    case startingUp
    case ready
    case listening
    case working
    case paused

    var menuTitle: String {
        switch self {
        case .startingUp: "Yumi is getting ready"
        case .ready: "Yumi is ready"
        case .listening: "Yumi is listening"
        case .working: "Yumi is working"
        case .paused: "Yumi is paused"
        }
    }
}

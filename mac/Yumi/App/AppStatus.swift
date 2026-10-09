/// What Yumi is doing, shown as the first line of the menu.
///
/// Nothing drives this yet: the harness event stream (OBJ-14.5) and voice intake (OBJ-15) will.
enum AppStatus: String, CaseIterable, Sendable {
    case ready
    case listening
    case working
    case paused

    var menuTitle: String {
        switch self {
        case .ready: "Yumi is ready"
        case .listening: "Yumi is listening"
        case .working: "Yumi is working"
        case .paused: "Yumi is paused"
        }
    }
}

import Observation

/// The cursors on screen, observable so SwiftUI views update when one changes. Its own file,
/// because YumiProtocol's `Observation` type hides the Observation module where it is imported.
@MainActor
@Observable
final class CursorRoster {
    var cursors: [String: OverlayCursor] = [:]
}

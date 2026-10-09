import Observation

/// What the menu shows about tiling. In its own file because the protocol's `Observation` type
/// clashes with the Observation module wherever `YumiProtocol` is imported.
@Observable
@MainActor
final class TilingState {
    /// Some windows are still where Yumi put them, so the menu offers "Put windows back".
    var hasSavedLayout = false
}

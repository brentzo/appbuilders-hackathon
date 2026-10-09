/// Listens for the user's spoken answer right after Yumi asks something (OBJ-17.5). Voice capture
/// is OBJ-15: it implements this with the same capture path as push-to-talk.
@MainActor
protocol ReplyListening: AnyObject {
    /// The transcript of what the user said, or nil when nothing usable was heard.
    func listenForReply() async -> String?
}

/// STAND-IN until OBJ-15's voice capture: hears nothing, so the panel's buttons are the only way
/// to answer.
@MainActor
final class NoReplyListener: ReplyListening {
    func listenForReply() async -> String? { nil }
}

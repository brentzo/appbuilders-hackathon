import YumiProtocol

/// The app's own words around approval cards (OBJ-40.4): button labels and what Yumi says after
/// a "Don't". The card text itself always comes from the harness's `Approval`; nothing here builds
/// or changes it. The declined lines are the SPEC-07 "Draft copy", still waiting for Patrick's
/// review, so they live here to change in one place.
enum ApprovalCopy {
    static let send = "Send"
    static let dontSend = "Don't send"
    static let delete = "Delete"
    static let dontDelete = "Don't delete"

    /// "and 7 more" under the first 5 names of a delete card (SPEC-07 r10).
    static func andMore(_ count: Int) -> String {
        "and \(count) more"
    }

    /// What Yumi says after the user declines.
    static func declined(_ approval: Approval) -> String {
        switch approval.kind {
        case .delete:
            approval.files?.count == 1
                ? "Okay, I left the file alone. Want me to do anything else with it?"
                : "Okay, I left the files alone. Want me to do anything else with them?"
        case .send:
            // The approval does not say which app sends; the harness's text says "this message"
            // for Messages and "this email" for Mail (SPEC-07 Draft copy).
            approval.text.contains("this message")
                ? "Okay, I didn't send it. The message is still there if you want to change anything."
                : "Okay, I didn't send it. The draft is still there if you want to change anything."
        }
    }

    /// SPEC-11 r11: long copy is shown in full, and only its first sentence is spoken.
    /// A sentence ends at ".", "?", or "!" followed by a space, so "old-invoice.pdf" stays whole.
    static func firstSentence(_ text: String) -> String {
        var index = text.startIndex
        while index < text.endIndex {
            let next = text.index(after: index)
            if ".?!".contains(text[index]), next == text.endIndex || text[next] == " " {
                return String(text[..<next])
            }
            index = next
        }
        return text
    }

    enum SpokenSendReply: Equatable {
        case sendIt
        case dontSend
        case unclear
    }

    /// "Send it" approves a send by voice (SPEC-07 r15); any negation never does. A delete is never
    /// approved by voice (r11), so this is only asked for a send.
    static func spokenSendReply(_ heard: String) -> SpokenSendReply {
        let words = heard.lowercased().replacingOccurrences(of: "'", with: "")
            .split { !$0.isLetter }.map(String.init)
        let negations: Set<String> = ["dont", "do", "not", "no", "never", "cancel", "wait", "stop"]
        if words.contains(where: negations.contains) {
            return words.contains("send") ? .dontSend : .unclear
        }
        let saysSendIt = zip(words, words.dropFirst()).contains { $0 == "send" && $1 == "it" }
        return saysSendIt ? .sendIt : .unclear
    }
}

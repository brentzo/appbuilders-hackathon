/// Words Yumi's goals use that recognizers mishear without a hint. On 2026-10-10 Apple's on-device
/// recognizer heard "Export my keynote deck" as "Expert my keynote tech", twice. Both recognizers
/// are told to expect these: Apple's as contextual strings, Whisper as its prompt.
nonisolated enum GoalVocabulary {
    /// The demo's apps, folders, and verbs, and Yumi's own name.
    static let words = [
        "Yumi", "export", "deck", "Keynote", "PDF", "Notes", "Downloads", "Finder", "Desktop", "Documents",
        "Pages", "Numbers", "Mail", "Preview",
    ]

    /// Whole phrases help Apple's recognizer most, since it weighs each string as a unit.
    static let phrases = [
        "export my Keynote deck", "export my Keynote deck as a PDF", "the files in my Downloads folder",
        "a new note in Notes",
    ]

    /// Apple's recognizer: words and phrases to expect.
    static var contextualStrings: [String] { phrases + words }

    /// Whisper's prompt: the vocabulary as earlier text, which biases spelling without being a
    /// command. Kept short, since a long prompt can leak into the transcript of a short recording.
    static let whisperPrompt = "Yumi, export my Keynote deck as a PDF. Notes, Downloads, Finder."
}

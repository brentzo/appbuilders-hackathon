import Foundation
import Testing
@preconcurrency import WhisperKit
@testable import Yumi

/// Goal speech expects the demo's words, so "Export my Keynote deck" is not heard as "Expert my
/// keynote tech" (Brent's live check, 2026-10-10).
struct GoalVocabularyTests {
    @Test func theDemoWordsAreExpected() {
        for word in ["export", "deck", "Keynote", "PDF", "Notes", "Downloads", "Finder"] {
            #expect(GoalVocabulary.contextualStrings.contains(word), "\(word) is not in the goal vocabulary")
        }
        #expect(GoalVocabulary.contextualStrings.contains("export my Keynote deck"))
    }

    @Test func whispersPromptNamesTheDemoWords() {
        for word in ["export", "Keynote", "deck", "PDF", "Notes", "Downloads", "Finder"] {
            #expect(GoalVocabulary.whisperPrompt.contains(word))
        }
    }

    /// The prompt goes in as text tokens after a space; special tokens never do, since WhisperKit
    /// adds its own "previous text" marker.
    @Test func whispersPromptTokensAreTextOnly() {
        let tokenizer = FakeTokenizer()
        let tokens = WhisperModel.promptTokens(" export my deck ", tokenizer: tokenizer)
        #expect(tokenizer.encoded == [" export my deck"])
        #expect(tokens == [1, 2])
    }

    final class FakeTokenizer: WhisperTokenizer, @unchecked Sendable {
        var encoded: [String] = []
        /// Two text tokens, then one at the start of the special range.
        func encode(text: String) -> [Int] {
            encoded.append(text)
            return [1, 2, 50257]
        }
        func decode(tokens: [Int]) -> String { "" }
        func convertTokenToId(_ token: String) -> Int? { nil }
        func convertIdToToken(_ id: Int) -> String? { nil }
        var specialTokens: SpecialTokens {
            SpecialTokens(
                endToken: 50257, englishToken: 50259, noSpeechToken: 50363, noTimestampsToken: 50364,
                specialTokenBegin: 50257, startOfPreviousToken: 50362, startOfTranscriptToken: 50258,
                timeTokenBegin: 50365, transcribeToken: 50360, translateToken: 50359, whitespaceToken: 220
            )
        }
        var allLanguageTokens: Set<Int> { [] }
        func splitToWordTokens(tokenIds: [Int]) -> (words: [String], wordTokens: [[Int]]) { ([], []) }
    }
}

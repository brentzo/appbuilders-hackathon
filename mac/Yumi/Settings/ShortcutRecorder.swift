import AppKit
import SwiftUI

/// A button that shows the current shortcut and records a new one when clicked.
/// Esc cancels. A shortcut needs Control, Option, or Command.
struct ShortcutRecorder: View {
    @Binding var shortcut: KeyShortcut

    @State private var isRecording = false
    @State private var needsModifier = false
    @State private var monitor: Any?

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Button {
                isRecording ? stopRecording() : startRecording()
            } label: {
                Text(isRecording ? "Press a shortcut" : shortcut.displayText)
                    .monospacedDigit()
                    .frame(minWidth: 110)
            }
            .accessibilityHint(isRecording ? "Press the keys to use, or Escape to cancel" : "Click to change the shortcut")

            if needsModifier {
                Text("Include ⌃, ⌥, or ⌘.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .onDisappear(perform: stopRecording)
    }

    private func startRecording() {
        needsModifier = false
        isRecording = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53 { // Esc
                stopRecording()
                return nil
            }
            if let recorded = KeyShortcut(event: event) {
                shortcut = recorded
                stopRecording()
            } else {
                needsModifier = true
            }
            return nil
        }
    }

    private func stopRecording() {
        isRecording = false
        if let monitor {
            NSEvent.removeMonitor(monitor)
        }
        monitor = nil
    }
}
